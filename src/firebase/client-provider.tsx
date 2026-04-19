'use client';

import { ReactNode, useMemo } from 'react';
import { initializeFirebase } from './index';
import { FirebaseProvider } from './provider';

/**
 * Client-side provider that initializes Firebase and makes it available via context.
 * This component ensures Firebase is initialized only once on the client and 
 * avoids serialization errors between Server and Client components.
 */
export function FirebaseClientProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { firebaseApp, firestore, auth } = useMemo(() => initializeFirebase(), []);

  return (
    <FirebaseProvider firebaseApp={firebaseApp} firestore={firestore} auth={auth}>
      {children}
    </FirebaseProvider>
  );
}
