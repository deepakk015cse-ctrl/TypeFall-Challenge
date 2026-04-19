
"use client";

import { useState, useEffect, useRef, useCallback, createRef, useMemo } from 'react';
import { Trophy, Clock, Pause, Play, Settings, RefreshCw, Star, Globe, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { WORDS } from '@/lib/words';
import { cn } from '@/lib/utils';
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { collection, query, orderBy, limit, addDoc, serverTimestamp } from 'firebase/firestore';
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
  const animationFrameId = useRef<number>();
  const spawnTimeoutId = useRef<NodeJS.Timeout>();
  const timerIntervalId = useRef<NodeJS.Timeout>();

  const wordsRef = useRef(new Map<number, { y: number; speed: number; ref: React.RefObject<HTMLSpanElement> }>());

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
    wordsRef.current.clear();
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [difficulty, gameDuration]);

  const spawnWord = useCallback(() => {
    if (!gameAreaRef.current) return;
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
    
    wordsRef.current.set(wordId, { y: newWord.y, speed: newWord.speed, ref: newWord.ref });
    setActiveWords((prev) => [...prev, newWord]);
  }, [wordSpeed]);

  const gameLoop = useCallback(() => {
    if (gameAreaRef.current && !isPaused) {
      const gameHeight = gameAreaRef.current.offsetHeight;
      const wordsToRemove: number[] = [];
  
      wordsRef.current.forEach((word, id) => {
        word.y += word.speed;
        if (word.ref.current) {
          word.ref.current.style.transform = `translateY(${word.y}px)`;
        }
        if (word.y >= gameHeight) {
          wordsToRemove.push(id);
        }
      });
  
      if (wordsToRemove.length > 0) {
        wordsToRemove.forEach(id => wordsRef.current.delete(id));
        setActiveWords(prev => prev.filter(word => !wordsToRemove.includes(word.id)));
      }
    }
    animationFrameId.current = requestAnimationFrame(gameLoop);
  }, [isPaused]);


  useEffect(() => {
    if (gameState === 'playing' && !isPaused) {
      animationFrameId.current = requestAnimationFrame(gameLoop);
      
      spawnTimeoutId.current = setInterval(() => {
        spawnWord();
      }, spawnRate);

      timerIntervalId.current = setInterval(() => {
        setTimeRemaining(prev => prev - 1);
      }, 1000);

      inputRef.current?.focus();
    } else {
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
      if (spawnTimeoutId.current) clearInterval(spawnTimeoutId.current);
      if (timerIntervalId.current) clearInterval(timerIntervalId.current);
    }
    
    return () => {
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
      if (spawnTimeoutId.current) clearInterval(spawnTimeoutId.current);
      if (timerIntervalId.current) clearInterval(timerIntervalId.current);
    };
  }, [gameState, isPaused, spawnRate, gameLoop, spawnWord]);


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
      setLevel(prev => prev + 1);
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
        if (gameAreaRef.current && matchedWord.y < gameAreaRef.current.offsetHeight) {
            setScore((prev) => prev + POINTS_PER_WORD);
            wordsRef.current.delete(matchedWord.id);
            setActiveWords((prev) => prev.filter((_, i) => i !== matchedIndex));
            setInputValue('');
        } else {
            setInputValue('');
        }
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
        const permissionError = new FirestorePermissionError({
          path: 'scores',
          operation: 'create',
          requestResourceData: scoreData
        });
        errorEmitter.emit('permission-error', permissionError);
      });
  };

  const togglePause = () => {
    if(gameState !== 'playing') return;
    setIsPaused(prev => !prev);
  }

  const renderLeaderboard = () => (
    <div className="mt-8 w-full">
      <h3 className="text-xl font-bold text-ring mb-4 flex items-center gap-2 justify-center">
        <Globe className="w-5 h-5" /> Global Leaderboard
      </h3>
      <div className="bg-card/40 rounded-lg overflow-hidden">
        {leaderboard && leaderboard.length > 0 ? (
          <div className="divide-y divide-border">
            {leaderboard.map((entry, idx) => (
              <div key={idx} className="flex justify-between p-3 items-center">
                <div className="flex items-center gap-3">
                  <span className={cn("w-6 text-sm font-bold", idx === 0 ? "text-yellow-400" : "text-muted-foreground")}>
                    #{idx + 1}
                  </span>
                  <span className="font-medium">{entry.playerName}</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xs text-muted-foreground capitalize">{entry.difficulty}</span>
                  <span className="font-bold text-primary">{entry.score}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="p-4 text-center text-muted-foreground text-sm">No scores yet. Be the first!</p>
        )}
      </div>
    </div>
  );

  return (
    <main className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground font-headline overflow-hidden">
        <div className="stars"></div>
        <div className="twinkling"></div>
        <div className="clouds"></div>
      
      {gameState === 'menu' && (
        <Card className="w-full max-w-2xl text-center bg-card/80 backdrop-blur-sm animate-fade-in-up z-10 my-8">
          <CardHeader>
            <CardTitle className="text-5xl font-bold text-primary" style={{textShadow: '0 0 10px hsl(var(--primary))'}}>TypeFall Challenge</CardTitle>
          </CardHeader>
          <CardContent className="max-h-[70vh] overflow-y-auto">
            <p className="text-muted-foreground mb-6">Type the falling words to score points before time runs out!</p>
            <div className="flex items-center justify-center gap-2 text-2xl mb-4 text-amber-400">
              <Star className="w-7 h-7"/>
              <span className="font-bold">Personal Best: {highScore}</span>
            </div>
            
            <div className="flex flex-col gap-6 mb-8 text-left">
              <div className="space-y-2">
                <Label className="font-bold text-lg">Your Name</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input 
                    value={playerName} 
                    onChange={(e) => setPlayerName(e.target.value)} 
                    placeholder="Enter explorer name..." 
                    className="pl-9 bg-input/50"
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label className="font-bold text-lg">Difficulty</Label>
                <ToggleGroup 
                  type="single" 
                  value={difficulty} 
                  onValueChange={(value: 'easy' | 'medium' | 'hard') => value && setDifficulty(value)}
                  className="grid grid-cols-3 bg-muted/20 p-1 rounded-md"
                >
                  <ToggleGroupItem value="easy" className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">Easy</ToggleGroupItem>
                  <ToggleGroupItem value="medium" className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">Medium</ToggleGroupItem>
                  <ToggleGroupItem value="hard" className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">Hard</ToggleGroupItem>
                </ToggleGroup>
              </div>
            </div>

            {renderLeaderboard()}
          </CardContent>
          <CardFooter className="flex justify-center pt-4">
            <Button onClick={() => resetGame()} size="lg" className="text-xl px-12 h-14" disabled={!playerName.trim()}>
              Launch Mission
            </Button>
          </CardFooter>
        </Card>
      )}

      {gameState === 'playing' && (
        <div className="relative w-full h-screen" ref={gameAreaRef}>
          {isPaused && (
             <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-20">
                <Card className="w-full max-w-sm text-center bg-card/90">
                    <CardHeader>
                        <CardTitle className="text-4xl">System Halted</CardTitle>
                    </CardHeader>
                    <CardFooter className="flex justify-center">
                        <Button onClick={togglePause} size="lg">Resume</Button>
                    </CardFooter>
                </Card>
             </div>
          )}
          
          <div className="absolute top-4 left-4 right-4 flex justify-between items-center z-10 p-4 bg-transparent rounded-lg">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-2xl font-bold text-primary" style={{textShadow: '0 0 8px hsl(var(--primary))'}}>
                  <Trophy className="w-7 h-7" />
                  <span>Score: {score}</span>
              </div>
              <div className="text-xl font-bold text-muted-foreground hidden sm:block">Level: {level}</div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-2xl font-bold text-ring" style={{textShadow: '0 0 8px hsl(var(--ring))'}}>
                  <Clock className="w-7 h-7" />
                  <span>{timeRemaining}s</span>
              </div>
              <Button variant="ghost" size="icon" className="h-9 w-9" onClick={togglePause}>
                <Settings className="w-5 h-5 text-yellow-400" />
              </Button>
            </div>
          </div>

          {activeWords.map((word) => (
            <span
              key={word.id}
              ref={word.ref}
              className={cn(
                "absolute font-bold text-lg transition-colors duration-200 z-10",
                word.text === highlightedWord ? "text-primary scale-110" : "text-foreground"
              )}
              style={{
                left: `${word.x}px`,
                top: `0px`,
                transform: `translateY(${word.y}px)`,
                textShadow: word.text === highlightedWord ? '0 0 10px hsl(var(--primary))' : 'none'
              }}
            >
              {word.text}
            </span>
          ))}
          <div className="absolute bottom-10 left-1/2 -translate-x-1/2 w-full max-w-md px-4 z-10">
             <Input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Type the cosmic words..."
                className="w-full text-center text-lg h-14 bg-input/40 backdrop-blur-md border-primary/30 focus:ring-2 focus:ring-primary"
                autoComplete="off"
                disabled={isPaused}
            />
          </div>
        </div>
      )}

      {gameState === 'gameOver' && (
        <Card className="w-full max-w-md text-center bg-card/80 backdrop-blur-sm animate-fade-in-up z-10 my-8">
          <CardHeader>
            <CardTitle className="text-5xl font-bold text-destructive" style={{textShadow: '0 0 10px hsl(var(--destructive))'}}>Mission End</CardTitle>
          </CardHeader>
          <CardContent className="max-h-[70vh] overflow-y-auto">
            {score > highScore && (
                <p className="text-2xl mb-4 text-amber-400 font-bold" style={{textShadow: '0 0 8px hsl(var(--primary))'}}>New personal record!</p>
            )}
            <p className="text-2xl mb-2">Total Power</p>
            <p className="text-6xl font-bold text-primary mb-6" style={{textShadow: '0 0 10px hsl(var(--primary))'}}>{score}</p>
            
            {!hasSaved ? (
              <div className="space-y-4 mb-6 p-4 bg-muted/20 rounded-lg">
                <Label className="font-bold">Publish to Global Leaderboard?</Label>
                <div className="flex gap-2">
                  <Input 
                    value={playerName} 
                    onChange={(e) => setPlayerName(e.target.value)} 
                    placeholder="Your name..." 
                    className="bg-input/50"
                  />
                  <Button onClick={saveScore} disabled={isSaving || !playerName.trim()}>
                    {isSaving ? "Saving..." : "Save"}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-green-400 mb-6 font-bold flex items-center justify-center gap-2">
                <Star className="w-5 h-5 fill-current" /> Score Logged Globally!
              </p>
            )}

            {renderLeaderboard()}
          </CardContent>
          <CardFooter className="flex flex-col gap-3 justify-center">
            <Button onClick={() => resetGame()} className="w-full h-12 text-lg">Retry Mission</Button>
            <Button onClick={() => setGameState('menu')} variant="outline" className="w-full h-12 text-lg">Main Menu</Button>
          </CardFooter>
        </Card>
      )}
    </main>
  );
}
