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

interface Theme {
	id: string;
	name: string;
	description: string;
	icon: string;
}

interface AppState {
	roomId: string | null;
	players: Player[];
	playerCount: number;
	currentPlayerId: string | null;
	connected: boolean;
	round: number;
	chatHistory: ChatMessage[];
	thinkingForPlayers: string[]; // Player IDs with pending queries
	lastWinner: Player | null;
	hasSecretWord: boolean;
	// Theme system
	currentTheme: string | null;
	themeSelectionActive: boolean;
	pendingTheme: string | null;
	creatorId: string | null;
	themes: Theme[];
	gameOver: boolean;
	winners: Player[];
}

const playerEmojis = ["🐰", "🐱", "🐶", "🐼", "🐨", "🦦", "🐧", "🐹"];

function Lobby({ onCreateRoom, onJoinRoom, error }: { onCreateRoom: () => void, onJoinRoom: (code: string) => void, error: string | null }) {
	const [roomCode, setRoomCode] = useState("");

	return (
		<div className="game-container theme-selection-container">
			<h1 className="game-title">Word Oracle</h1>
			<p className="game-subtitle">A multiplayer guessing game powered by AI</p>

			<div className="lobby-card">
				<h2 className="lobby-title">Start Playing</h2>
				
				<button className="create-room-btn" onClick={onCreateRoom}>
					Create New Room
				</button>

				<div className="divider">
					<span>OR</span>
				</div>

				<div className="join-room-section">
					<input 
						type="text" 
						className="room-code-input" 
						placeholder="Enter Room Code"
						value={roomCode}
						onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
						maxLength={8}
					/>
					<button 
						className="join-room-btn" 
						onClick={() => onJoinRoom(roomCode)}
						disabled={roomCode.length < 4}
					>
						Join Room
					</button>
				</div>
				
				{error && <div className="error-message">{error}</div>}
			</div>
		</div>
	);
}

function GameBoard() {
	const [appState, setAppState] = useState<AppState>({
		roomId: null,
		players: [],
		playerCount: 0,
		currentPlayerId: null,
		connected: false,
		round: 0,
		chatHistory: [],
		thinkingForPlayers: [],
		lastWinner: null,
		hasSecretWord: false,
		currentTheme: null,
		themeSelectionActive: false, // Default false until joined
		pendingTheme: null,
		creatorId: null,
		themes: [],
		gameOver: false,
		winners: [],
	});

	const [selectedTheme, setSelectedTheme] = useState<string | null>(null);
	const [ws, setWs] = useState<WebSocket | null>(null);
	const [inputValue, setInputValue] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [skippedWord, setSkippedWord] = useState<{ word: string; theme: string } | null>(null);
	const chatContainerRef = useRef<HTMLDivElement>(null);
	const [copySuccess, setCopySuccess] = useState(false);

	// Connect to WebSocket
	useEffect(() => {
		const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
		const socket = new WebSocket(`${protocol}//${window.location.host}`);

		socket.onopen = () => {
			console.log("Connected to game server");
			// Check URL for room code
			const params = new URLSearchParams(window.location.search);
			const roomParam = params.get("room");
			if (roomParam) {
				console.log("Auto-joining room:", roomParam);
				// Small delay to ensure WS is ready
				setTimeout(() => {
					socket.send(JSON.stringify({ type: "join_room", roomId: roomParam }));
				}, 100);
			}
		};

		socket.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data);

				if (data.type === "connected") {
					setAppState((prev) => ({ ...prev, connected: true }));
				} else if (data.type === "welcome") {
					// Update URL without reloading
					const newUrl = new URL(window.location.href);
					newUrl.searchParams.set("room", data.roomId);
					window.history.pushState({}, "", newUrl);

					setAppState((prev) => ({
						...prev,
						roomId: data.roomId,
						players: data.players,
						playerCount: data.playerCount,
						currentPlayerId: data.playerId,
						round: data.round,
						chatHistory: data.chatHistory,
						thinkingForPlayers: data.thinkingForPlayers || [],
						lastWinner: data.lastWinner,
						hasSecretWord: data.hasSecretWord,
						currentTheme: data.currentTheme,
						themeSelectionActive: data.themeSelectionActive,
						pendingTheme: data.pendingTheme,
						creatorId: data.creatorId,
						themes: data.themes || [],
						gameOver: false,
						winners: [],
					}));
				} else if (data.type === "state") {
					setAppState((prev) => ({
						...prev,
						roomId: data.roomId || prev.roomId,
						players: data.players,
						playerCount: data.playerCount,
						round: data.round,
						chatHistory: data.chatHistory,
						thinkingForPlayers: data.thinkingForPlayers || [],
						lastWinner: data.lastWinner,
						hasSecretWord: data.hasSecretWord,
						currentTheme: data.currentTheme,
						themeSelectionActive: data.themeSelectionActive,
						pendingTheme: data.pendingTheme,
						creatorId: data.creatorId,
						themes: data.themes || [],
					}));
				} else if (data.type === "theme_update") {
					setAppState((prev) => ({
						...prev,
						currentTheme: data.currentTheme,
						themeSelectionActive: data.themeSelectionActive,
						pendingTheme: data.pendingTheme,
						creatorId: data.creatorId,
						themes: data.themes || prev.themes,
						gameOver: false,
						winners: [],
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
					setSkippedWord({ word: data.word, theme: data.theme });
				} else if (data.type === "game_over") {
					setAppState((prev) => ({
						...prev,
						gameOver: true,
						winners: data.winners,
						players: data.players, // Update players to get final scores
					}));
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
			setAppState((prev) => ({ ...prev, connected: false, roomId: null }));
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

	const handleCreateRoom = useCallback(() => {
		if (ws) {
			ws.send(JSON.stringify({ type: "create_room" }));
		}
	}, [ws]);

	const handleJoinRoom = useCallback((code: string) => {
		if (ws) {
			ws.send(JSON.stringify({ type: "join_room", roomId: code }));
		}
	}, [ws]);

	const handleVoteTheme = useCallback((themeId: string) => {
		setSelectedTheme(themeId);
		if (ws) {
			ws.send(JSON.stringify({ type: "vote_theme", themeId }));
		}
	}, [ws]);

	const handleConfirmTheme = useCallback(() => {
		if (ws && selectedTheme) {
			ws.send(JSON.stringify({ type: "confirm_theme", themeId: selectedTheme }));
		}
	}, [ws, selectedTheme]);

	const handleChangeTheme = useCallback(() => {
		if (ws) {
			ws.send(JSON.stringify({ type: "change_theme" }));
			setSelectedTheme(null);
		}
	}, [ws]);

	const copyRoomCode = () => {
		if (appState.roomId) {
			navigator.clipboard.writeText(appState.roomId).then(() => {
				setCopySuccess(true);
				setTimeout(() => setCopySuccess(false), 2000);
			});
		}
	};

	const currentPlayer = appState.players.find(p => p.id === appState.currentPlayerId);

	// Sort players by score for leaderboard
	const sortedPlayers = [...appState.players].sort((a, b) => b.score - a.score);

	// Get current theme info
	const currentThemeInfo = appState.themes.find(t => t.id === appState.currentTheme);

	if (!appState.roomId) {
		return <Lobby onCreateRoom={handleCreateRoom} onJoinRoom={handleJoinRoom} error={error} />;
	}

	// Theme selection screen
	if (appState.themeSelectionActive) {
		const isCreator = appState.creatorId === appState.currentPlayerId;
		const activeThemeId = selectedTheme || appState.pendingTheme;

		return (
			<div className="game-container theme-selection-container">
				<div className="room-header">
					<h1 className="game-title">Word Oracle</h1>
					<div className="room-info" onClick={copyRoomCode} title="Click to copy room code">
						Room: <span className="room-code">{appState.roomId}</span>
						<span className="copy-icon">{copySuccess ? "✅" : "📋"}</span>
					</div>
				</div>

				<div className="theme-selection">
					<h2 className="theme-selection-title">Choose a Theme</h2>
					<p className="theme-selection-subtitle">
						{isCreator ? "Select a category for the words you'll be guessing" : "Waiting for the host to select a theme..."}
					</p>

					<div className="theme-grid">
						{appState.themes.map((theme) => {
							const isSelected = appState.pendingTheme === theme.id;
							const isLocalSelected = selectedTheme === theme.id;
							const showSelected = isCreator ? (isLocalSelected || isSelected) : isSelected;

							return (
								<button
									key={theme.id}
									className={`theme-card ${showSelected ? "selected" : ""}`}
									onClick={() => isCreator && handleVoteTheme(theme.id)}
									disabled={!isCreator}
									style={{ cursor: isCreator ? 'pointer' : 'default' }}
								>
									<span className="theme-icon">{theme.icon}</span>
									<span className="theme-name">{theme.name}</span>
									<span className="theme-description">{theme.description}</span>
									{isSelected && !isCreator && (
										<span className="theme-votes">Host Selection</span>
									)}
								</button>
							);
						})}
					</div>

					{isCreator ? (
						<button
							className="confirm-theme-btn"
							onClick={handleConfirmTheme}
							disabled={!activeThemeId}
						>
							Start Game {activeThemeId && `with ${appState.themes.find(t => t.id === activeThemeId)?.name}`}
						</button>
					) : (
						<div style={{ marginTop: '20px', fontStyle: 'italic', opacity: 0.7, color: 'var(--text-brown)', fontSize: '1.2rem' }}>
							Waiting for host to start the game...
						</div>
					)}

					<div className="players-waiting">
						<p>{appState.players.length} player{appState.players.length !== 1 ? "s" : ""} in lobby</p>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="game-container">
			<div className="room-header-small" onClick={copyRoomCode} title="Click to copy room code">
				Room: <strong>{appState.roomId}</strong> {copySuccess ? "✅" : "📋"}
			</div>

			<h1 className="game-title">Word Oracle</h1>

			{error && <div className="error-toast">{error}</div>}

			{/* Skipped round popup */}
			{skippedWord && (
				<div className="popup-overlay">
					<div className="popup-dialog">
						<div className="popup-icon">🔮</div>
						<h2>Round Skipped!</h2>
						<p className="popup-label">The answer was:</p>
						<p className="popup-word">{skippedWord.word}</p>
						<p className="popup-category">{appState.themes.find(t => t.id === skippedWord.theme)?.name || skippedWord.theme}</p>
						<button className="popup-btn" onClick={handleClosePopupAndNextRound}>
							Next Round
						</button>
					</div>
				</div>
			)}

			{/* Game Over popup */}
			{appState.gameOver && (
				<div className="popup-overlay">
					<div className="popup-dialog">
						<div className="popup-icon">🏆</div>
						<h2>Game Over!</h2>

						<div style={{ marginBottom: '20px' }}>
							{appState.winners.length === 1 ? (
								<p style={{ fontSize: '1.2rem', marginBottom: '8px' }}>
									The winner is <strong style={{ color: '#FF6B6B' }}>{appState.winners[0].name}</strong>!
								</p>
							) : (
								<p style={{ fontSize: '1.2rem', marginBottom: '8px' }}>
									It's a tie between {appState.winners.map(w => w.name).join(" and ")}!
								</p>
							)}
						</div>

						<div className="final-scores">
							<h3>Final Scores</h3>
							<ul>
								{sortedPlayers.map((p, i) => (
									<li key={p.id} className={appState.winners.some(w => w.id === p.id) ? 'winner' : ''}>
										<span>#{i + 1} {p.name} {p.id === appState.currentPlayerId && "(you)"}</span>
										<span>{p.score} pts</span>
									</li>
								))}
							</ul>
						</div>

						<button className="popup-btn" onClick={handleChangeTheme}>
							Return to Menu
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
						<div className="round-info">
							Round {appState.round || "..."}
							{currentThemeInfo && (
								<span className="current-theme-badge">
									{currentThemeInfo.icon} {currentThemeInfo.name}
								</span>
							)}
						</div>
						{appState.lastWinner && (
							<span className="last-winner">Last winner: {appState.lastWinner.name}</span>
						)}
					</div>

					{/* Chat area */}
					<div className="chat-container" ref={chatContainerRef}>
						{appState.chatHistory.length === 0 && !appState.hasSecretWord && (
							<div className="chat-empty">
								<div className="oracle-icon">🔮</div>
								<p>Waiting for the Oracle to think of something...</p>
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
							Ask questions like "Is it alive?" or guess directly with "Guess: Is it a dog?"
						</p>
					</div>
				</div>
			</div>

			<div className="game-actions">
				<button className="new-round-btn" onClick={handleSkipRound} disabled={isAnyoneThinking}>
					Skip Round
				</button>
				<button className="change-theme-btn" onClick={handleChangeTheme} disabled={isAnyoneThinking || appState.creatorId !== appState.currentPlayerId}>
					Change Theme
				</button>
			</div>
		</div>
	);
}

const root = createRoot(document.getElementById("root")!);
root.render(<GameBoard />);