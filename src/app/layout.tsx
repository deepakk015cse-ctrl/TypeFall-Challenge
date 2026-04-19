
import type { Metadata } from 'next';
import './globals.css';
import { Toaster } from "@/components/ui/toaster"
import { initializeFirebase, FirebaseClientProvider } from '@/firebase';
import { FirebaseErrorListener } from '@/components/FirebaseErrorListener';

export const metadata: Metadata = {
  title: 'TypeFall Challenge',
  description: 'An interactive typing game where words fall from the sky.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { firebaseApp, firestore, auth } = initializeFirebase();

  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&display=swap" rel="stylesheet" />
      </head>
      <body className="font-headline antialiased">
        <FirebaseClientProvider firebaseApp={firebaseApp} firestore={firestore} auth={auth}>
          <FirebaseErrorListener />
          {children}
          <Toaster />
        </FirebaseClientProvider>
      </body>
    </html>
  );
}
