import index from "./index.html";
import { Database } from "bun:sqlite";

// Groq configuration
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_API_KEY = process.env.GROQ_API_KEY!;
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

// Local model configuration (llama-server)
const LOCAL_MODEL_URL = process.env.LOCAL_MODEL_URL || "http://localhost:8080/v1/chat/completions";

// Flag to choose between local model and Groq for user queries
// Set USE_LOCAL_MODEL=false to use Groq API for user queries
const USE_LOCAL_MODEL = process.env.USE_LOCAL_MODEL !== "false";


// Database setup
const db = new Database("words.db");
db.run(`
	CREATE TABLE IF NOT EXISTS words (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		word TEXT NOT NULL UNIQUE,
		category TEXT NOT NULL,
		facts TEXT NOT NULL
	)
`);

// Knowledge corpus types
interface WordEntry {
	word: string;
	category: "person" | "place" | "thing" | "animal" | "concept" | "brand" | "character";
	facts: string;
}

// Database helper functions
function getWordCountFromDb(): number {
	const result = db.query("SELECT COUNT(*) as count FROM words").get() as { count: number };
	return result.count;
}

function saveWordsToDb(words: WordEntry[]): void {
	const insert = db.prepare("INSERT OR IGNORE INTO words (word, category, facts) VALUES (?, ?, ?)");
	for (const entry of words) {
		insert.run(entry.word, entry.category, entry.facts);
	}
}

function deleteWordFromDb(word: string): void {
	db.run("DELETE FROM words WHERE word = ?", [word]);
}

function getRandomWordFromDb(): WordEntry | null {
	const result = db.query("SELECT word, category, facts FROM words ORDER BY RANDOM() LIMIT 1").get() as WordEntry | null;
	return result;
}

async function callGroq(prompt: string, systemPrompt?: string): Promise<string> {
	const messages: Array<{ role: string; content: string }> = [];

	if (systemPrompt) {
		messages.push({ role: "system", content: systemPrompt });
	}
	messages.push({ role: "user", content: prompt });

	const response = await fetch(GROQ_API_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"Authorization": `Bearer ${GROQ_API_KEY}`,
		},
		body: JSON.stringify({
			model: GROQ_MODEL,
			messages,
			temperature: 0.7,
		}),
	});

	if (!response.ok) {
		throw new Error(`Groq API error: ${response.status} ${response.statusText}`);
	}

	const data = await response.json();
	return data.choices?.[0]?.message?.content?.trim() || "";
}

// Call local model (llama-server) for user queries
async function callLocalModel(prompt: string, systemPrompt?: string): Promise<string> {
	const messages: Array<{ role: string; content: string }> = [];

	if (systemPrompt) {
		messages.push({ role: "system", content: systemPrompt });
	}
	messages.push({ role: "user", content: prompt });

	const response = await fetch(LOCAL_MODEL_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			messages,
			temperature: 0.7,
		}),
	});

	if (!response.ok) {
		throw new Error(`Local model error: ${response.status} ${response.statusText}`);
	}

	const data = await response.json();
	return data.choices?.[0]?.message?.content?.trim() || "";
}

interface Player {
	id: string;
	name: string;
	color: string;
	score: number;
}

interface ChatMessage {
	id: string;
	playerId: string;
	playerName: string;
	playerColor: string;
	type: "question" | "guess" | "answer" | "system";
	content: string;
	timestamp: number;
	replyTo?: {
		playerName: string;
		playerColor: string;
	};
}

interface GameState {
	players: Player[];
	maxPlayers: number;
	secretWord: string | null;
	currentWordEntry: WordEntry | null;
	round: number;
	chatHistory: ChatMessage[];
	thinkingForPlayers: Set<string>; // Track which players have pending queries
	lastWinner: Player | null;
	corpusReady: boolean;
}

const gameState: GameState = {
	players: [],
	maxPlayers: 8,
	secretWord: null,
	currentWordEntry: null,
	round: 0,
	chatHistory: [],
	thinkingForPlayers: new Set(),
	lastWinner: null,
	corpusReady: false,
};

const playerColors = [
	"#FF6B6B", // coral red
	"#4ECDC4", // teal
	"#FFE66D", // sunny yellow
	"#95E1D3", // mint
	"#F38181", // salmon
	"#AA96DA", // lavender
	"#FCBAD3", // pink
	"#A8D8EA", // sky blue
];

const connections = new Map<string, any>();

function generatePlayerId(): string {
	return Math.random().toString(36).substring(2, 9);
}

function generatePlayerName(index: number): string {
	const adjectives = ["Happy", "Sleepy", "Bouncy", "Fuzzy", "Cozy", "Silly", "Jolly", "Wiggly"];
	const animals = ["Bunny", "Kitten", "Puppy", "Panda", "Koala", "Otter", "Penguin", "Hamster"];
	return `${adjectives[index % adjectives.length]} ${animals[index % animals.length]}`;
}

function generateMessageId(): string {
	return Math.random().toString(36).substring(2, 12);
}

function broadcastState() {
	const message = JSON.stringify({
		type: "state",
		players: gameState.players,
		playerCount: gameState.players.length,
		round: gameState.round,
		chatHistory: gameState.chatHistory,
		thinkingForPlayers: Array.from(gameState.thinkingForPlayers),
		lastWinner: gameState.lastWinner,
		hasSecretWord: !!gameState.secretWord,
		corpusReady: gameState.corpusReady,
	});

	for (const ws of connections.values()) {
		ws.send(message);
	}
}

function broadcastMessage(msg: ChatMessage) {
	const message = JSON.stringify({
		type: "chat_message",
		message: msg,
	});
	for (const ws of connections.values()) {
		ws.send(message);
	}
}

function broadcastThinkingForPlayer(playerId: string, isThinking: boolean) {
	if (isThinking) {
		gameState.thinkingForPlayers.add(playerId);
	} else {
		gameState.thinkingForPlayers.delete(playerId);
	}
	const message = JSON.stringify({
		type: "thinking",
		playerId,
		isThinking,
		thinkingForPlayers: Array.from(gameState.thinkingForPlayers),
	});
	for (const ws of connections.values()) {
		ws.send(message);
	}
}

function clearAllThinkingStates() {
	gameState.thinkingForPlayers.clear();
	const message = JSON.stringify({
		type: "thinking",
		playerId: null,
		isThinking: false,
		thinkingForPlayers: [],
	});
	for (const ws of connections.values()) {
		ws.send(message);
	}
}

function broadcastNewRound(winner: Player | null) {
	gameState.lastWinner = winner;
	const message = JSON.stringify({
		type: "new_round",
		round: gameState.round,
		winner,
		players: gameState.players,
	});
	for (const ws of connections.values()) {
		ws.send(message);
	}
}

// Single Groq call to generate the knowledge corpus
const CORPUS_GENERATOR_PROMPT = `Generate a comprehensive knowledge corpus for a word guessing game. Create exactly 10 diverse words with EXTENSIVE facts about each (minimum 500 words per entry).

Requirements:
- Mix of categories: people (real/fictional), places, things, animals, concepts, brands, characters
- Mix of difficulty: some easy (cat, pizza), some medium (telescope, democracy), some hard (Cleopatra, Kubernetes)
- Facts must be EXTREMELY comprehensive - at least 500 words per entry

Respond ONLY with valid JSON in this exact format:
{
  "words": [
    {
      "word": "Eiffel Tower",
      "category": "place",
      "facts": "[500+ words of comprehensive facts here]"
    }
  ]
}

Each "facts" field MUST contain at least 500 words covering ALL of these aspects in great detail:

1. IDENTITY & CLASSIFICATION:
- What category it belongs to (thing, person, place, animal, concept, brand, character)
- What type/subcategory it is
- Scientific classification if applicable
- Official names, nicknames, alternative names

2. PHYSICAL PROPERTIES (if applicable):
- Size (height, width, length, weight, mass)
- Color(s) and visual appearance
- Material composition
- Shape and structure
- Texture and feel
- Smell and taste (if relevant)
- Sound it makes (if any)

3. EXISTENCE & NATURE:
- Is it alive or not alive?
- Is it real or fictional?
- Is it natural or man-made?
- Is it edible or not edible?
- Is it dangerous or safe?
- Is it common or rare?
- Is it visible to naked eye?
- Can it move on its own?

4. TEMPORAL ASPECTS:
- When it was created/born/discovered
- How old it is
- Historical significance
- Evolution over time
- Lifespan (if alive)
- Era it belongs to

5. SPATIAL ASPECTS:
- Where it is located/found
- Geographic distribution
- Where it originated
- Countries/regions associated with it
- Can it be found indoors or outdoors?
- Is it portable or stationary?

6. POPULARITY & CULTURE:
- How famous/well-known it is
- Pop culture references
- Appearances in media (movies, books, songs)
- Awards or recognition received
- Cultural significance
- Symbolism and what it represents

7. FUNCTION & PURPOSE:
- What it is used for
- How it works
- Who uses it
- Benefits it provides
- Problems it solves

8. RELATIONSHIPS & ASSOCIATIONS:
- Related items/concepts
- Things commonly associated with it
- Part of what larger system/category
- What it contains or is made of
- What depends on it

9. COMPARISONS:
- Bigger than what (list multiple items)
- Smaller than what (list multiple items)
- Similar to what
- Different from what
- More expensive or cheaper than common items
- More common or rarer than similar things

10. MISCELLANEOUS:
- Interesting trivia
- Common misconceptions
- Fun facts
- Records or achievements
- Controversies if any
- Future outlook

Write each facts entry as a continuous, dense paragraph with hundreds of factual statements. Do not use bullet points or formatting - just plain text sentences.

Generate 10 diverse entries now:`;

const ORACLE_SYSTEM_PROMPT = `
You are a friendly, conversational Oracle answering yes/no questions about a secret word.

ABSOLUTE RULES (never break these):
1. Respond with exactly ONE short sentence.
2. Begin with "Yes," "No," or a very broad category (e.g. "It's a thing.", "It's a place.").
3. NEVER say the secret word.
4. NEVER describe, explain, define, compare, hint at, or give examples of what it is.
5. NEVER add extra facts beyond what is directly asked.

STYLE RULES:
- Sound warm, natural, and conversational.
- Avoid robotic phrasing.
- No reasoning, no elaboration, no follow-ups.

GOOD:
"Yes, it’s alive!"
"No, not edible."
"It’s a thing!"
"Yes, quite famous!"

BAD:
"The answer is..."
"It’s similar to..."
"Think about..."
"It’s a tall metal structure"
`;


const QUESTION_PROMPT = `
FACTS (may be empty or incomplete):
{FACTS}

QUESTION:
{QUESTION}

INSTRUCTIONS:
- Answer ONLY the question asked.
- Use ONE short, friendly sentence.
- Start with "Yes," "No," or a broad category.
- Do NOT infer, guess, or add new information.
- NEVER say or imply "{SECRET_WORD}".
- NEVER describe, define, compare, or hint at what it is.

ANSWER:
`;


const GUESS_DETECTOR_PROMPT = `
A GUESS directly names or clearly identifies a specific thing.
A QUESTION asks only about properties, traits, or categories.

GUESS examples:
"Is it a dog?" → GUESS: dog
"Pizza?" → GUESS: pizza
"Is it the Eiffel Tower?" → GUESS: Eiffel Tower
"Is it Taylor Swift?" → GUESS: Taylor Swift

NOT_A_GUESS examples:
"Is it alive?" → NOT_A_GUESS
"Is it a person?" → NOT_A_GUESS
"Is it edible?" → NOT_A_GUESS
"Is it famous?" → NOT_A_GUESS
"What color is it?" → NOT_A_GUESS
"Is it an animal?" → NOT_A_GUESS

Message:
"{MESSAGE}"

Respond with EXACTLY ONE line:
- "GUESS: <named thing>" OR
- "NOT_A_GUESS"
`;


// Generate new words using Groq and save to database
async function generateAndSaveWords(): Promise<void> {
	console.log("Generating new words with Groq...");

	const response = await fetch(GROQ_API_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"Authorization": `Bearer ${GROQ_API_KEY}`,
		},
		body: JSON.stringify({
			model: GROQ_MODEL,
			messages: [{ role: "user", content: CORPUS_GENERATOR_PROMPT }],
			temperature: 0.7,
		}),
	});

	if (!response.ok) {
		throw new Error(`Groq API error: ${response.status} ${response.statusText}`);
	}

	const data = await response.json();
	const text = (data.choices?.[0]?.message?.content || "").trim();

	// Parse JSON from response (handle markdown code blocks)
	let jsonStr = text;
	const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (jsonMatch) {
		jsonStr = jsonMatch[1];
	}

	const parsed = JSON.parse(jsonStr.trim());
	const words: WordEntry[] = parsed.words;

	// Save to database
	saveWordsToDb(words);
	console.log(`Generated and saved ${words.length} words to database (total: ${getWordCountFromDb()})`);
}

// Select a random word from the database (don't delete until correctly guessed)
function selectWordFromDb(): WordEntry | null {
	const wordEntry = getRandomWordFromDb();
	return wordEntry;
}

// Answer question using local model
async function answerQuestion(question: string): Promise<string> {
	if (!gameState.secretWord || !gameState.currentWordEntry) {
		return "No game in progress.";
	}

	const prompt = QUESTION_PROMPT
		.replace("{SECRET_WORD}", gameState.secretWord)
		.replace("{CATEGORY}", gameState.currentWordEntry.category)
		.replace("{FACTS}", gameState.currentWordEntry.facts)
		.replace("{QUESTION}", question);

	return USE_LOCAL_MODEL
		? await callLocalModel(prompt, ORACLE_SYSTEM_PROMPT)
		: await callGroq(prompt, ORACLE_SYSTEM_PROMPT);
}

// Check guess using simple string matching (no AI needed)
function checkGuess(guess: string): boolean {
	if (!gameState.secretWord) return false;

	const normalizedGuess = guess.toLowerCase().trim()
		.replace(/^(the|a|an)\s+/i, ""); // Remove articles
	const normalizedWord = gameState.secretWord.toLowerCase().trim()
		.replace(/^(the|a|an)\s+/i, "");

	// Exact match
	if (normalizedGuess === normalizedWord) return true;

	// Handle plural/singular
	if (normalizedGuess + "s" === normalizedWord) return true;
	if (normalizedGuess === normalizedWord + "s") return true;

	// Check if guess contains the word or vice versa (for multi-word answers)
	if (normalizedGuess.includes(normalizedWord) || normalizedWord.includes(normalizedGuess)) {
		// Only match if it's substantial (more than 3 chars matching)
		if (normalizedWord.length > 3) return true;
	}

	return false;
}

// Detect guess using local model
async function detectGuess(message: string): Promise<string | null> {
	const prompt = GUESS_DETECTOR_PROMPT.replace("{MESSAGE}", message);

	const response = USE_LOCAL_MODEL
		? await callLocalModel(prompt)
		: await callGroq(prompt);

	if (response.toUpperCase().startsWith("GUESS:")) {
		return response.substring(6).trim();
	}
	return null;
}

// Minimum words required to skip Groq generation
const MIN_WORDS_IN_DB = 5;

// Initialize the knowledge corpus (called once when first player joins)
async function initializeCorpus(): Promise<boolean> {
	if (gameState.corpusReady) {
		return true;
	}

	try {
		const wordCount = getWordCountFromDb();
		console.log(`Database has ${wordCount} words`);

		if (wordCount >= MIN_WORDS_IN_DB) {
			console.log("Using existing words from database");
		} else {
			console.log("Not enough words in database, generating with Groq...");
			await generateAndSaveWords();
		}

		gameState.corpusReady = true;
		return true;
	} catch (error) {
		console.error("Failed to initialize corpus:", error);
		return false;
	}
}

async function startNewRound(winner: Player | null = null) {
	gameState.round++;
	gameState.chatHistory = [];
	gameState.lastWinner = winner;

	// Clear any pending thinking states from previous round
	clearAllThinkingStates();

	// Ensure corpus is ready
	if (!gameState.corpusReady) {
		const systemMsg: ChatMessage = {
			id: generateMessageId(),
			playerId: "system",
			playerName: "Game",
			playerColor: "#8B7355",
			type: "system",
			content: "The Oracle is preparing... please wait.",
			timestamp: Date.now(),
		};
		gameState.chatHistory.push(systemMsg);
		broadcastState();

		const success = await initializeCorpus();
		if (!success) {
			const errorMsg: ChatMessage = {
				id: generateMessageId(),
				playerId: "system",
				playerName: "Game",
				playerColor: "#8B7355",
				type: "system",
				content: "Failed to initialize the Oracle. Please try again.",
				timestamp: Date.now(),
			};
			gameState.chatHistory.push(errorMsg);
			broadcastState();
			return;
		}
	}

	// Select word from database
	let wordEntry = selectWordFromDb();

	// If no words left, generate more
	if (!wordEntry) {
		console.log("No words left in database, generating more...");
		try {
			await generateAndSaveWords();
			wordEntry = selectWordFromDb();
		} catch (error) {
			console.error("Failed to generate new words:", error);
		}
	}

	if (!wordEntry) {
		console.error("No words available");
		return;
	}

	gameState.secretWord = wordEntry.word;
	gameState.currentWordEntry = wordEntry;

	// Add system message
	const systemMsg: ChatMessage = {
		id: generateMessageId(),
		playerId: "system",
		playerName: "Game",
		playerColor: "#8B7355",
		type: "system",
		content: winner
			? `Round ${gameState.round} begins! ${winner.name} won the last round!`
			: `Round ${gameState.round} begins! I'm thinking of something... Ask yes/no questions to figure out what it is!`,
		timestamp: Date.now(),
	};
	gameState.chatHistory.push(systemMsg);

	broadcastNewRound(winner);
	broadcastMessage(systemMsg);
}

const server = Bun.serve({
	port: 3000,
	routes: {
		"/": index,
	},
	fetch(req, server) {
		if (req.headers.get("upgrade") === "websocket") {
			const success = server.upgrade(req);
			if (success) {
				return undefined;
			}
			return new Response("WebSocket upgrade failed", { status: 400 });
		}
		return new Response("Not Found", { status: 404 });
	},
	websocket: {
		open(ws) {
			const playerId = generatePlayerId();
			const playerIndex = gameState.players.length;

			if (playerIndex >= gameState.maxPlayers) {
				ws.send(JSON.stringify({ type: "error", message: "Game is full!" }));
				ws.close();
				return;
			}

			const player: Player = {
				id: playerId,
				name: generatePlayerName(playerIndex),
				color: playerColors[playerIndex % playerColors.length],
				score: 0,
			};

			(ws as any).playerId = playerId;
			connections.set(playerId, ws);
			gameState.players.push(player);

			// Send welcome state to new player
			ws.send(JSON.stringify({
				type: "welcome",
				playerId,
				player,
				players: gameState.players,
				playerCount: gameState.players.length,
				round: gameState.round,
				chatHistory: gameState.chatHistory,
				thinkingForPlayers: Array.from(gameState.thinkingForPlayers),
				lastWinner: gameState.lastWinner,
				hasSecretWord: !!gameState.secretWord,
				corpusReady: gameState.corpusReady,
			}));

			// Broadcast join message
			const joinMsg: ChatMessage = {
				id: generateMessageId(),
				playerId: "system",
				playerName: "Game",
				playerColor: "#8B7355",
				type: "system",
				content: `${player.name} joined the game!`,
				timestamp: Date.now(),
			};
			gameState.chatHistory.push(joinMsg);
			broadcastState();

			// Start first round if this is the first player
			if (gameState.players.length === 1 && !gameState.secretWord) {
				startNewRound();
			}

			console.log(`Player joined: ${player.name} (${playerId}). Total: ${gameState.players.length}`);
		},

		async message(ws, message) {
			try {
				const data = JSON.parse(message.toString());
				const playerId = (ws as any).playerId;
				const player = gameState.players.find(p => p.id === playerId);

				if (!player) return;

				if (data.type === "ping") {
					ws.send(JSON.stringify({ type: "pong" }));
				} else if (data.type === "question" || data.type === "message") {
					// Only block if no secret word or this specific player already has a pending query
					if (!gameState.secretWord || gameState.thinkingForPlayers.has(playerId)) return;

					const message = data.content.trim();
					if (!message) return;

					// Add player's message to chat
					const playerMsg: ChatMessage = {
						id: generateMessageId(),
						playerId: player.id,
						playerName: player.name,
						playerColor: player.color,
						type: "question",
						content: message,
						timestamp: Date.now(),
					};
					gameState.chatHistory.push(playerMsg);
					broadcastMessage(playerMsg);

					// Track the round when this request started
					const requestRound = gameState.round;

					broadcastThinkingForPlayer(playerId, true);
					try {
						// First, detect if this is a guess attempt
						const guessedWord = await detectGuess(message);

						// Check if round changed while we were processing
						if (gameState.round !== requestRound) {
							// Round changed, discard this response
							gameState.thinkingForPlayers.delete(playerId);
							return;
						}

						if (guessedWord) {
							// It's a guess - check if correct (synchronous now)
							const isCorrect = checkGuess(guessedWord);

							if (isCorrect) {
								// Winner! Clear all pending thinking states
								clearAllThinkingStates();

								player.score++;
								const revealedWord = gameState.secretWord;

								// Remove the word from database since it was guessed
								if (revealedWord) {
									deleteWordFromDb(revealedWord);
									console.log(`Removed "${revealedWord}" from database (correctly guessed)`);
								}

								const winMsg: ChatMessage = {
									id: generateMessageId(),
									playerId: "ai",
									playerName: "Oracle",
									playerColor: "#6B5B95",
									type: "answer",
									content: `YES! The word was "${revealedWord}"! ${player.name} wins this round!`,
									timestamp: Date.now(),
									replyTo: {
										playerName: player.name,
										playerColor: player.color,
									},
								};
								gameState.chatHistory.push(winMsg);
								broadcastMessage(winMsg);

								// Start new round after a delay
								setTimeout(() => {
									startNewRound(player);
								}, 3000);
							} else {
								const wrongMsg: ChatMessage = {
									id: generateMessageId(),
									playerId: "ai",
									playerName: "Oracle",
									playerColor: "#6B5B95",
									type: "answer",
									content: "No, that's not it. Keep trying!",
									timestamp: Date.now(),
									replyTo: {
										playerName: player.name,
										playerColor: player.color,
									},
								};
								gameState.chatHistory.push(wrongMsg);
								broadcastMessage(wrongMsg);
								broadcastThinkingForPlayer(playerId, false);
							}
						} else {
							// It's a regular question - answer it
							const answer = await answerQuestion(message);

							// Check again if round changed while answering
							if (gameState.round !== requestRound) {
								gameState.thinkingForPlayers.delete(playerId);
								return;
							}

							const answerMsg: ChatMessage = {
								id: generateMessageId(),
								playerId: "ai",
								playerName: "Oracle",
								playerColor: "#6B5B95",
								type: "answer",
								content: answer,
								timestamp: Date.now(),
								replyTo: {
									playerName: player.name,
									playerColor: player.color,
								},
							};
							gameState.chatHistory.push(answerMsg);
							broadcastMessage(answerMsg);
							broadcastThinkingForPlayer(playerId, false);
						}
					} catch (error) {
						console.error("Error processing message:", error);
						// Only clear thinking if still in the same round
						if (gameState.round === requestRound) {
							broadcastThinkingForPlayer(playerId, false);
						}
					}

				} else if (data.type === "new_round") {
					// Manual new round request (only if no queries are pending)
					if (gameState.thinkingForPlayers.size === 0) {
						startNewRound();
					}
				} else if (data.type === "skip_round") {
					// Skip round - send the answer to all players (they'll request new round after seeing it)
					if (gameState.thinkingForPlayers.size === 0 && gameState.secretWord) {
						const skippedMsg = JSON.stringify({
							type: "round_skipped",
							word: gameState.secretWord,
							category: gameState.currentWordEntry?.category,
						});
						for (const ws of connections.values()) {
							ws.send(skippedMsg);
						}
					}
				}
			} catch (e) {
				console.error("Invalid message:", e);
			}
		},

		close(ws) {
			const playerId = (ws as any).playerId;
			if (playerId) {
				const playerIndex = gameState.players.findIndex(p => p.id === playerId);
				if (playerIndex !== -1) {
					const player = gameState.players[playerIndex];
					gameState.players.splice(playerIndex, 1);
					connections.delete(playerId);

					// Broadcast leave message
					const leaveMsg: ChatMessage = {
						id: generateMessageId(),
						playerId: "system",
						playerName: "Game",
						playerColor: "#8B7355",
						type: "system",
						content: `${player.name} left the game.`,
						timestamp: Date.now(),
					};
					gameState.chatHistory.push(leaveMsg);

					console.log(`Player left: ${player.name} (${playerId}). Total: ${gameState.players.length}`);

					broadcastState();
				}
			}
		},
	},
	development: {
		hmr: true,
		console: true,
	},
});

console.log("Word Oracle server running at http://localhost:3000");
console.log(`Groq model (corpus generation): ${GROQ_MODEL}`);
console.log(`User queries: ${USE_LOCAL_MODEL ? `Local model (${LOCAL_MODEL_URL})` : `Groq API (${GROQ_MODEL})`}`);
