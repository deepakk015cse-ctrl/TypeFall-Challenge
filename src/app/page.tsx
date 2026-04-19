
"use client";

import { useState, useEffect, useRef, useCallback, createRef, useMemo } from 'react';
import { Trophy, Clock, Pause, Play, Settings, RefreshCw, Star, Globe, User, Moon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { WORDS } from '@/lib/words';
import { cn } from '@/lib/utils';
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { collection, query, orderBy, limit, addDoc } from 'firebase/firestore';
import { useFirestore, useCollection } from '@/firebase';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';

const WORDS_PER_LEVEL = 10;
const POINTS_PER_WORD = 2;
const INITIAL_GAME_DURATION = 60;

const DIFFICULTY_SETTINGS = {
  easy: { baseSpeed: 0.5, increment: 0.05, spawnRate: 3000, spawnDecrement: 50 },
  medium: { baseSpeed: 0.8, increment: 0.075, spawnRate: 2500, spawnDecrement: 75 },
  hard: { baseSpeed: 1.2, increment: 0.1, spawnRate: 2000, spawnDecrement: 100 },
};

const MIN_SPAWN_RATE = 500;

type Word = {
  id: number;
  text: string;
  x: number;
  y: number;
  speed: number;
  ref: React.RefObject<HTMLSpanElement>;
};

export default function TypeFallGame() {
  const db = useFirestore();
  const [gameState, setGameState] = useState<'menu' | 'playing' | 'gameOver'>('menu');
  const [isPaused, setIsPaused] = useState(false);
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(INITIAL_GAME_DURATION);
  const [gameDuration, setGameDuration] = useState(INITIAL_GAME_DURATION);
  const [activeWords, setActiveWords] = useState<Word[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [level, setLevel] = useState(1);
  const [highlightedWord, setHighlightedWord] = useState<string | null>(null);
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [playerName, setPlayerName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [hasSaved, setHasSaved] = useState(false);

  const gameAreaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastWordId = useRef(0);
  const animationFrameId = useRef<number | null>(null);
  const spawnIntervalId = useRef<NodeJS.Timeout | null>(null);
  const timerIntervalId = useRef<NodeJS.Timeout | null>(null);

  // We use a Map to track internal word positions to avoid React state overhead every frame
  const wordsInternalRef = useRef(new Map<number, { y: number; speed: number; ref: React.RefObject<HTMLSpanElement> }>());

  const { baseSpeed, increment, spawnRate: baseSpawnRate, spawnDecrement } = DIFFICULTY_SETTINGS[difficulty];
  const spawnRate = Math.max(MIN_SPAWN_RATE, baseSpawnRate - (level - 1) * spawnDecrement);
  const wordSpeed = baseSpeed + (level - 1) * increment;

  // Leaderboard fetching
  const leaderboardQuery = useMemo(() => {
    if (!db) return null;
    return query(collection(db, 'scores'), orderBy('score', 'desc'), limit(10));
  }, [db]);
  const { data: leaderboard } = useCollection(leaderboardQuery);

  useEffect(() => {
    const savedHighScore = localStorage.getItem('typefallHighScore');
    if (savedHighScore) {
      setHighScore(parseInt(savedHighScore, 10));
    }
    const savedName = localStorage.getItem('typefallPlayerName');
    if (savedName) {
      setPlayerName(savedName);
    }
  }, []);

  const spawnWord = useCallback(() => {
    if (!gameAreaRef.current || gameState !== 'playing' || isPaused) return;
    
    const gameWidth = gameAreaRef.current.offsetWidth;
    const text = WORDS[Math.floor(Math.random() * WORDS.length)];
    const wordWidth = text.length * 12;
    const wordId = lastWordId.current++;

    const newWord: Word = {
      id: wordId,
      text,
      x: Math.random() * (gameWidth - wordWidth),
      y: -20,
      speed: wordSpeed,
      ref: createRef(),
    };
    
    wordsInternalRef.current.set(wordId, { y: newWord.y, speed: newWord.speed, ref: newWord.ref });
    setActiveWords((prev) => [...prev, newWord]);
  }, [wordSpeed, gameState, isPaused]);

  const gameLoop = useCallback(() => {
    if (gameState !== 'playing' || isPaused) {
        animationFrameId.current = requestAnimationFrame(gameLoop);
        return;
    }

    if (gameAreaRef.current) {
      const gameHeight = gameAreaRef.current.offsetHeight;
      const wordsToRemove: number[] = [];
  
      wordsInternalRef.current.forEach((word, id) => {
        word.y += word.speed;
        if (word.ref.current) {
          word.ref.current.style.transform = `translateY(${word.y}px)`;
        }
        // Only mark for removal if gameHeight is detected (prevents instant removal on load)
        if (gameHeight > 0 && word.y >= gameHeight) {
          wordsToRemove.push(id);
        }
      });
  
      if (wordsToRemove.length > 0) {
        wordsToRemove.forEach(id => wordsInternalRef.current.delete(id));
        setActiveWords(prev => prev.filter(word => !wordsToRemove.includes(word.id)));
      }
    }
    animationFrameId.current = requestAnimationFrame(gameLoop);
  }, [gameState, isPaused]);

  const startEngine = useCallback(() => {
    if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
    animationFrameId.current = requestAnimationFrame(gameLoop);
    
    if (spawnIntervalId.current) clearInterval(spawnIntervalId.current);
    spawnIntervalId.current = setInterval(spawnWord, spawnRate);

    if (timerIntervalId.current) clearInterval(timerIntervalId.current);
    timerIntervalId.current = setInterval(() => {
      setTimeRemaining(prev => prev - 1);
    }, 1000);
  }, [gameLoop, spawnWord, spawnRate]);

  const stopEngine = useCallback(() => {
    if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
    if (spawnIntervalId.current) clearInterval(spawnIntervalId.current);
    if (timerIntervalId.current) clearInterval(timerIntervalId.current);
    animationFrameId.current = null;
    spawnIntervalId.current = null;
    timerIntervalId.current = null;
  }, []);

  useEffect(() => {
    if (gameState === 'playing' && !isPaused) {
      startEngine();
      inputRef.current?.focus();
    } else {
      stopEngine();
    }
    return () => stopEngine();
  }, [gameState, isPaused, startEngine, stopEngine]);

  useEffect(() => {
    if (timeRemaining <= 0 && gameState === 'playing') {
      setGameState('gameOver');
      if (score > highScore) {
        setHighScore(score);
        localStorage.setItem('typefallHighScore', String(score));
      }
    }
  }, [timeRemaining, gameState, score, highScore]);
  
  useEffect(() => {
    if (score > 0 && score % (WORDS_PER_LEVEL * POINTS_PER_WORD) === 0) {
      setLevel(prev => Math.floor(score / (WORDS_PER_LEVEL * POINTS_PER_WORD)) + 1);
    }
  }, [score]);

  useEffect(() => {
    if (inputValue) {
        const match = activeWords.find(word => word.text.startsWith(inputValue));
        setHighlightedWord(match ? match.text : null);
    } else {
        setHighlightedWord(null);
    }
  }, [inputValue, activeWords]);

  const resetGame = useCallback((newDifficulty = difficulty, newDuration = gameDuration) => {
    setScore(0);
    setTimeRemaining(newDuration);
    setGameDuration(newDuration);
    setActiveWords([]);
    setInputValue('');
    setLevel(1);
    setGameState('playing');
    setIsPaused(false);
    setDifficulty(newDifficulty);
    setHasSaved(false);
    lastWordId.current = 0;
    wordsInternalRef.current.clear();
  }, [difficulty, gameDuration]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isPaused) return;
    setInputValue(e.target.value.toLowerCase().trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isPaused) return;
    if (e.key === 'Enter' && inputValue) {
      const matchedIndex = activeWords.findIndex((word) => word.text === inputValue);

      if (matchedIndex !== -1) {
        const matchedWord = activeWords[matchedIndex];
        setScore((prev) => prev + POINTS_PER_WORD);
        wordsInternalRef.current.delete(matchedWord.id);
        setActiveWords((prev) => prev.filter((w) => w.id !== matchedWord.id));
        setInputValue('');
      } else {
        setInputValue('');
      }
    }
  };

  const saveScore = () => {
    if (!db || !playerName.trim() || isSaving || hasSaved) return;
    setIsSaving(true);
    const scoreData = {
      playerName: playerName.trim(),
      score: score,
      difficulty: difficulty,
      createdAt: new Date().toISOString()
    };

    localStorage.setItem('typefallPlayerName', playerName.trim());

    addDoc(collection(db, 'scores'), scoreData)
      .then(() => {
        setIsSaving(false);
        setHasSaved(true);
      })
      .catch(async (err) => {
        setIsSaving(false);
        errorEmitter.emit('permission-error', new FirestorePermissionError({
          path: 'scores',
          operation: 'create',
          requestResourceData: scoreData
        }));
      });
  };

  const renderLeaderboard = () => (
    <div className="mt-8 w-full">
      <h3 className="text-xl font-bold text-ring mb-4 flex items-center gap-2 justify-center">
        <Globe className="w-5 h-5" /> Global Ranking
      </h3>
      <div className="bg-card/40 rounded-lg overflow-hidden border border-primary/20">
        {leaderboard && leaderboard.length > 0 ? (
          <div className="divide-y divide-border">
            {leaderboard.map((entry, idx) => (
              <div key={idx} className="flex justify-between p-3 items-center hover:bg-primary/5 transition-colors">
                <div className="flex items-center gap-3">
                  <span className={cn("w-6 text-sm font-bold", idx === 0 ? "text-yellow-400" : "text-muted-foreground")}>
                    #{idx + 1}
                  </span>
                  <span className="font-medium text-foreground/90">{entry.playerName}</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">{entry.difficulty}</span>
                  <span className="font-bold text-primary">{entry.score}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="p-4 text-center text-muted-foreground text-sm">Waiting for cosmic explorers...</p>
        )}
      </div>
    </div>
  );

  return (
    <main className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground font-headline overflow-hidden relative">
        {/* Space Background Layers */}
        <div className="stars pointer-events-none opacity-50"></div>
        <div className="twinkling pointer-events-none opacity-60"></div>
        <div className="clouds pointer-events-none opacity-20"></div>
        
        {/* Dynamic Celestial Elements */}
        <div className="absolute top-[10%] left-[15%] w-32 h-32 rounded-full bg-gradient-to-br from-purple-600/30 to-blue-900/10 blur-xl pointer-events-none animate-pulse"></div>
        <div className="absolute top-[20%] right-[10%] pointer-events-none opacity-40">
            <Moon className="w-24 h-24 text-primary fill-primary/20 blur-[1px]" />
        </div>
        <div className="absolute bottom-[15%] left-[5%] w-16 h-16 rounded-full bg-orange-500/20 blur-lg pointer-events-none"></div>
        <div className="absolute bottom-[30%] right-[20%] w-24 h-24 rounded-full bg-teal-500/10 border border-teal-500/20 blur-sm pointer-events-none"></div>

      {gameState === 'menu' && (
        <Card className="w-full max-w-2xl text-center bg-card/60 backdrop-blur-md animate-fade-in-up z-10 my-8 border-primary/20 shadow-[0_0_50px_rgba(0,0,0,0.5)]">
          <CardHeader>
            <CardTitle className="text-6xl font-black text-primary tracking-tighter" style={{textShadow: '0 0 20px hsl(var(--primary))'}}>TYPEFALL</CardTitle>
            <div className="text-xs uppercase tracking-[0.3em] text-ring font-bold">Galactic Division</div>
          </CardHeader>
          <CardContent className="max-h-[60vh] overflow-y-auto px-10">
            <div className="flex items-center justify-center gap-2 text-2xl mb-8 text-amber-400">
              <Trophy className="w-7 h-7"/>
              <span className="font-black">PERSONAL BEST: {highScore}</span>
            </div>
            
            <div className="flex flex-col gap-6 mb-8 text-left max-w-sm mx-auto">
              <div className="space-y-2">
                <Label className="font-bold text-sm uppercase text-muted-foreground">Pilot Identifier</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary" />
                  <Input 
                    value={playerName} 
                    onChange={(e) => setPlayerName(e.target.value)} 
                    placeholder="Enter pilot name..." 
                    className="pl-9 bg-black/40 border-primary/20 focus:border-primary"
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label className="font-bold text-sm uppercase text-muted-foreground">Difficulty Level</Label>
                <ToggleGroup 
                  type="single" 
                  value={difficulty} 
                  onValueChange={(value: 'easy' | 'medium' | 'hard') => value && setDifficulty(value)}
                  className="grid grid-cols-3 bg-black/40 p-1 rounded-md border border-primary/10"
                >
                  <ToggleGroupItem value="easy" className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground font-bold">EASY</ToggleGroupItem>
                  <ToggleGroupItem value="medium" className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground font-bold">MED</ToggleGroupItem>
                  <ToggleGroupItem value="hard" className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground font-bold">HARD</ToggleGroupItem>
                </ToggleGroup>
              </div>
            </div>

            {renderLeaderboard()}
          </CardContent>
          <CardFooter className="flex justify-center pb-10">
            <Button onClick={() => resetGame()} size="lg" className="text-xl px-16 h-16 rounded-full font-black shadow-[0_0_20px_rgba(var(--primary),0.5)] transition-all hover:scale-105" disabled={!playerName.trim()}>
              INITIATE LAUNCH
            </Button>
          </CardFooter>
        </Card>
      )}

      {gameState === 'playing' && (
        <div className="relative w-full h-screen" ref={gameAreaRef}>
          {isPaused && (
             <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
                <Card className="w-full max-w-sm text-center bg-card/80 border-primary/20">
                    <CardHeader>
                        <CardTitle className="text-4xl font-black text-primary">PAUSED</CardTitle>
                    </CardHeader>
                    <CardFooter className="flex flex-col gap-4 justify-center">
                        <Button onClick={() => setIsPaused(false)} size="lg" className="w-full h-14 text-xl">RESUME</Button>
                        <Button onClick={() => setGameState('menu')} variant="outline" className="w-full">QUIT MISSION</Button>
                    </CardFooter>
                </Card>
             </div>
          )}
          
          <div className="absolute top-6 left-6 right-6 flex justify-between items-center z-20">
            <div className="flex items-center gap-8">
              <div className="flex flex-col">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground">Power Accumulated</span>
                  <div className="flex items-center gap-2 text-3xl font-black text-primary" style={{textShadow: '0 0 10px hsl(var(--primary))'}}>
                    <Trophy className="w-6 h-6" />
                    <span>{score}</span>
                  </div>
              </div>
              <div className="flex flex-col">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground">Sector Level</span>
                  <div className="text-2xl font-black">{level}</div>
              </div>
            </div>
            <div className="flex items-center gap-8">
              <div className="flex flex-col items-end">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground">Oxygen Remaining</span>
                  <div className="flex items-center gap-2 text-3xl font-black text-ring" style={{textShadow: '0 0 10px hsl(var(--ring))'}}>
                    <Clock className="w-6 h-6" />
                    <span>{timeRemaining}S</span>
                  </div>
              </div>
              <Button variant="ghost" size="icon" className="h-12 w-12 rounded-full border border-white/10" onClick={() => setIsPaused(true)}>
                <Settings className="w-6 h-6 text-primary" />
              </Button>
            </div>
          </div>

          <div className="absolute inset-0 pointer-events-none">
            {activeWords.map((word) => (
                <span
                key={word.id}
                ref={word.ref}
                className={cn(
                    "absolute font-black text-xl transition-all duration-150 z-10 px-3 py-1 rounded bg-black/10 backdrop-blur-[2px]",
                    word.text === highlightedWord ? "text-primary scale-125 z-20" : "text-white/80"
                )}
                style={{
                    left: `${word.x}px`,
                    top: `0px`,
                    transform: `translateY(${word.y}px)`,
                    textShadow: word.text === highlightedWord ? '0 0 15px hsl(var(--primary))' : '0 2px 4px rgba(0,0,0,0.5)'
                }}
                >
                {word.text}
                </span>
            ))}
          </div>

          <div className="absolute bottom-16 left-1/2 -translate-x-1/2 w-full max-w-md px-6 z-30">
             <div className="relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-primary to-ring rounded-xl blur opacity-25 group-focus-within:opacity-50 transition duration-500"></div>
                <Input
                    ref={inputRef}
                    type="text"
                    value={inputValue}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    placeholder="ENTER COMMAND..."
                    className="relative w-full text-center text-xl font-black h-16 bg-black/60 backdrop-blur-xl border-white/10 focus:ring-0 focus:border-primary uppercase tracking-widest"
                    autoComplete="off"
                    disabled={isPaused}
                />
             </div>
          </div>
        </div>
      )}

      {gameState === 'gameOver' && (
        <Card className="w-full max-w-lg text-center bg-card/60 backdrop-blur-xl animate-fade-in-up z-20 my-8 border-destructive/20 shadow-[0_0_100px_rgba(255,0,0,0.2)]">
          <CardHeader>
            <CardTitle className="text-6xl font-black text-destructive italic tracking-tighter" style={{textShadow: '0 0 20px hsl(var(--destructive))'}}>CRITICAL ERROR</CardTitle>
            <div className="text-xs uppercase tracking-[0.3em] text-muted-foreground font-bold">Mission Terminated</div>
          </CardHeader>
          <CardContent className="max-h-[60vh] overflow-y-auto px-10 pb-6">
            {score > highScore && (
                <div className="bg-primary/10 border border-primary/20 rounded-lg p-4 mb-6">
                    <p className="text-xl text-primary font-black animate-pulse">NEW SECTOR RECORD ACHIEVED!</p>
                </div>
            )}
            <div className="mb-8">
                <p className="text-sm uppercase tracking-widest text-muted-foreground font-bold mb-1">Final Energy Rating</p>
                <p className="text-8xl font-black text-primary" style={{textShadow: '0 0 30px hsl(var(--primary))'}}>{score}</p>
            </div>
            
            {!hasSaved ? (
              <div className="space-y-4 mb-8 p-6 bg-black/40 rounded-xl border border-white/5">
                <Label className="font-bold text-xs uppercase text-muted-foreground">Transmit score to Star Command?</Label>
                <div className="flex gap-2">
                  <Input 
                    value={playerName} 
                    onChange={(e) => setPlayerName(e.target.value)} 
                    placeholder="Pilot ID..." 
                    className="bg-black/40 border-primary/20"
                  />
                  <Button onClick={saveScore} disabled={isSaving || !playerName.trim()} className="font-bold">
                    {isSaving ? "TRANSMITTING..." : "TRANSMIT"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="bg-green-500/10 border border-green-500/20 py-4 px-6 rounded-xl mb-8">
                <p className="text-green-400 font-black flex items-center justify-center gap-2 text-sm uppercase">
                    <Star className="w-4 h-4 fill-current" /> DATA SECURED GLOBALLY
                </p>
              </div>
            )}

            {renderLeaderboard()}
          </CardContent>
          <CardFooter className="flex flex-col gap-4 justify-center px-10 pb-10">
            <Button onClick={() => resetGame()} className="w-full h-14 text-xl font-black rounded-full shadow-[0_0_15px_rgba(var(--primary),0.3)]">REBOOT MISSION</Button>
            <Button onClick={() => setGameState('menu')} variant="outline" className="w-full h-12 rounded-full border-white/10 hover:bg-white/5">RETURN TO STATION</Button>
          </CardFooter>
        </Card>
      )}
    </main>
  );
}
