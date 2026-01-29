import React, { useState, useEffect, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

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

interface AppState {
	players: Player[];
	playerCount: number;
	currentPlayerId: string | null;
	connected: boolean;
	round: number;
	chatHistory: ChatMessage[];
	thinkingForPlayers: string[]; // Player IDs with pending queries
	lastWinner: Player | null;
	hasSecretWord: boolean;
	corpusReady: boolean;
}

const playerEmojis = ["🐰", "🐱", "🐶", "🐼", "🐨", "🦦", "🐧", "🐹"];

function GameBoard() {
	const [appState, setAppState] = useState<AppState>({
		players: [],
		playerCount: 0,
		currentPlayerId: null,
		connected: false,
		round: 0,
		chatHistory: [],
		thinkingForPlayers: [],
		lastWinner: null,
		hasSecretWord: false,
		corpusReady: false,
	});

	const [ws, setWs] = useState<WebSocket | null>(null);
	const [inputValue, setInputValue] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [skippedWord, setSkippedWord] = useState<{ word: string; category: string } | null>(null);
	const chatContainerRef = useRef<HTMLDivElement>(null);

	// Connect to WebSocket
	useEffect(() => {
		const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
		const socket = new WebSocket(`${protocol}//${window.location.host}`);

		socket.onopen = () => {
			console.log("Connected to game server");
			setAppState((prev) => ({ ...prev, connected: true }));
		};

		socket.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data);

				if (data.type === "welcome") {
					setAppState((prev) => ({
						...prev,
						players: data.players,
						playerCount: data.playerCount,
						currentPlayerId: data.playerId,
						round: data.round,
						chatHistory: data.chatHistory,
						thinkingForPlayers: data.thinkingForPlayers || [],
						lastWinner: data.lastWinner,
						hasSecretWord: data.hasSecretWord,
						corpusReady: data.corpusReady,
					}));
				} else if (data.type === "state") {
					setAppState((prev) => ({
						...prev,
						players: data.players,
						playerCount: data.playerCount,
						round: data.round,
						chatHistory: data.chatHistory,
						thinkingForPlayers: data.thinkingForPlayers || [],
						lastWinner: data.lastWinner,
						hasSecretWord: data.hasSecretWord,
						corpusReady: data.corpusReady,
					}));
				} else if (data.type === "chat_message") {
					setAppState((prev) => {
						// Prevent duplicate messages
						if (prev.chatHistory.some(msg => msg.id === data.message.id)) {
							return prev;
						}
						return {
							...prev,
							chatHistory: [...prev.chatHistory, data.message],
						};
					});
				} else if (data.type === "thinking") {
					setAppState((prev) => ({ ...prev, thinkingForPlayers: data.thinkingForPlayers || [] }));
				} else if (data.type === "new_round") {
					setSkippedWord(null); // Clear popup when new round starts
					setAppState((prev) => ({
						...prev,
						round: data.round,
						lastWinner: data.winner,
						players: data.players,
						chatHistory: [],
						hasSecretWord: true,
					}));
				} else if (data.type === "round_skipped") {
					setSkippedWord({ word: data.word, category: data.category });
				} else if (data.type === "error") {
					setError(data.message);
					setTimeout(() => setError(null), 5000);
				}
			} catch (e) {
				console.error("Failed to parse message:", e);
			}
		};

		socket.onclose = () => {
			console.log("Disconnected from game server");
			setAppState((prev) => ({ ...prev, connected: false }));
		};

		socket.onerror = (error) => {
			console.error("WebSocket error:", error);
		};

		setWs(socket);

		return () => {
			socket.close();
		};
	}, []);

	// Scroll to bottom on new messages
	useEffect(() => {
		if (chatContainerRef.current) {
			chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
		}
	}, [appState.chatHistory, appState.thinkingForPlayers]);

	// Ping to keep connection alive
	useEffect(() => {
		if (!ws || !appState.connected) return;

		const interval = setInterval(() => {
			if (ws.readyState === WebSocket.OPEN) {
				ws.send(JSON.stringify({ type: "ping" }));
			}
		}, 30000);

		return () => clearInterval(interval);
	}, [ws, appState.connected]);

	// Check if current player has a pending query
	const isCurrentPlayerThinking = appState.currentPlayerId
		? appState.thinkingForPlayers.includes(appState.currentPlayerId)
		: false;
	const isAnyoneThinking = appState.thinkingForPlayers.length > 0;

	const handleSubmit = useCallback(() => {
		if (!ws || !inputValue.trim() || isCurrentPlayerThinking) return;

		ws.send(JSON.stringify({
			type: "message",
			content: inputValue.trim(),
		}));
		setInputValue("");
	}, [ws, inputValue, isCurrentPlayerThinking]);

	const handleSkipRound = useCallback(() => {
		if (!ws || isAnyoneThinking) return;
		ws.send(JSON.stringify({ type: "skip_round" }));
	}, [ws, isAnyoneThinking]);

	const handleClosePopupAndNextRound = useCallback(() => {
		setSkippedWord(null);
		if (ws) {
			ws.send(JSON.stringify({ type: "new_round" }));
		}
	}, [ws]);

	const currentPlayer = appState.players.find(p => p.id === appState.currentPlayerId);

	// Sort players by score for leaderboard
	const sortedPlayers = [...appState.players].sort((a, b) => b.score - a.score);

	return (
		<div className="game-container">
			<h1 className="game-title">Word Oracle</h1>

			<div className={`connection-status ${appState.connected ? "connected" : "disconnected"}`}>
				{appState.connected ? "~ Connected ~" : "Connecting..."}
			</div>

			{error && <div className="error-toast">{error}</div>}

			{/* Skipped round popup */}
			{skippedWord && (
				<div className="popup-overlay">
					<div className="popup-dialog">
						<div className="popup-icon">🔮</div>
						<h2>Round Skipped!</h2>
						<p className="popup-label">The answer was:</p>
						<p className="popup-word">{skippedWord.word}</p>
						<p className="popup-category">{skippedWord.category}</p>
						<button className="popup-btn" onClick={handleClosePopupAndNextRound}>
							Next Round
						</button>
					</div>
				</div>
			)}

			<div className="main-layout">
				{/* Leaderboard sidebar */}
				<div className="leaderboard">
					<h2>Players</h2>
					<div className="leaderboard-list">
						{sortedPlayers.map((player, index) => (
							<div
								key={player.id}
								className={`leaderboard-item ${player.id === appState.currentPlayerId ? "current-player" : ""}`}
							>
								<div className="leaderboard-rank">#{index + 1}</div>
								<div
									className="leaderboard-avatar"
									style={{ backgroundColor: player.color }}
								>
									{playerEmojis[appState.players.findIndex(p => p.id === player.id) % playerEmojis.length]}
								</div>
								<div className="leaderboard-info">
									<div className="leaderboard-name">
										{player.name}
										{player.id === appState.currentPlayerId && <span className="you-badge">(you)</span>}
									</div>
									<div className="leaderboard-score">{player.score} pts</div>
								</div>
							</div>
						))}
					</div>
				</div>

				{/* Main game area */}
				<div className="game-area">
					<div className="round-indicator">
						Round {appState.round || "..."}
						{appState.lastWinner && (
							<span className="last-winner">Last winner: {appState.lastWinner.name}</span>
						)}
					</div>

					{/* Chat area */}
					<div className="chat-container" ref={chatContainerRef}>
						{appState.chatHistory.length === 0 && !appState.hasSecretWord && (
							<div className="chat-empty">
								<div className="oracle-icon">🔮</div>
								{!appState.corpusReady ? (
									<>
										<p>The Oracle is gathering knowledge...</p>
										<p className="corpus-hint">This only happens once per session</p>
									</>
								) : (
									<p>Waiting for the Oracle to think of something...</p>
								)}
							</div>
						)}

						{appState.chatHistory.map((msg) => (
							<div
								key={msg.id}
								className={`chat-message ${msg.type} ${msg.playerId === appState.currentPlayerId ? "own" : ""}`}
							>
								{msg.type === "system" ? (
									<div className="system-message">{msg.content}</div>
								) : msg.type === "answer" ? (
									<div className="answer-message">
										<div className="oracle-bubble">
											<div className="oracle-header">
												<span className="oracle-label">🔮 Oracle</span>
												{msg.replyTo && (
													<span className="reply-to">
														↩ <span style={{ color: msg.replyTo.playerColor }}>{msg.replyTo.playerName}</span>
													</span>
												)}
											</div>
											<p>{msg.content}</p>
										</div>
									</div>
								) : (
									<div className="player-message">
										<div
											className="message-avatar"
											style={{ backgroundColor: msg.playerColor }}
										>
											{playerEmojis[appState.players.findIndex(p => p.id === msg.playerId) % playerEmojis.length] || "?"}
										</div>
										<div className="message-content">
											<span className="message-sender">{msg.playerName}</span>
											<span className="message-type-badge">Q</span>
											<p>{msg.content}</p>
										</div>
									</div>
								)}
							</div>
						))}

						{appState.thinkingForPlayers.map((playerId) => {
							const player = appState.players.find(p => p.id === playerId);
							if (!player) return null;
							return (
								<div key={`thinking-${playerId}`} className="chat-message answer">
									<div className="answer-message">
										<div className="oracle-bubble thinking">
											<div className="oracle-header">
												<span className="oracle-label">🔮 Oracle</span>
												<span className="reply-to">
													↩ <span style={{ color: player.color }}>{player.name}</span>
												</span>
											</div>
											<div className="thinking-dots">
												<span></span><span></span><span></span>
											</div>
										</div>
									</div>
								</div>
							);
						})}
					</div>

					{/* Input area */}
					<div className="input-area">
						<div className="input-row">
							<input
								type="text"
								className="chat-input"
								placeholder="Ask a question or make a guess..."
								value={inputValue}
								onChange={(e) => setInputValue(e.target.value)}
								onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
								disabled={!appState.hasSecretWord}
							/>
							<button
								className="send-btn"
								onClick={handleSubmit}
								disabled={!inputValue.trim() || isCurrentPlayerThinking || !appState.hasSecretWord}
							>
								Send
							</button>
						</div>

						<p className="input-hint">
							Ask questions like "Is it alive?" or guess directly with "Is it a dog?"
						</p>
					</div>
				</div>
			</div>

			<button className="new-round-btn" onClick={handleSkipRound} disabled={isAnyoneThinking}>
				Skip Round
			</button>
		</div>
	);
}

const root = createRoot(document.getElementById("root")!);
root.render(<GameBoard />);
