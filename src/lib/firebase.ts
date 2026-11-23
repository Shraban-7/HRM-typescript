'use client';

import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getFirestore,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: Array<{
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }>;
  };
}

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// Always bind explicitly to the provisioned named Firestore database.
export const firestoreDb = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const firebaseAuth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: firebaseAuth.currentUser?.uid,
      email: firebaseAuth.currentUser?.email,
      emailVerified: firebaseAuth.currentUser?.emailVerified,
      isAnonymous: firebaseAuth.currentUser?.isAnonymous,
      tenantId: firebaseAuth.currentUser?.tenantId,
      providerInfo:
        firebaseAuth.currentUser?.providerData.map((provider) => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          email: provider.email,
          photoUrl: provider.photoURL,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

let connectionTested = false;

export async function testFirestoreConnection(): Promise<void> {
  if (typeof window === 'undefined' || connectionTested) return;
  connectionTested = true;
  try {
    await getDocFromServer(doc(firestoreDb, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

export type HrAssistantPersona = 'hr_advisor' | 'payroll_specialist' | 'quick_assistant';
export type AllowedGeminiModel = 'gemini-4-hydrogen' | 'gemini-3.1-flash-lite';
export type HrNoteCategory = 'Policy' | 'Payroll' | 'Compliance' | 'General';

export interface StoredChatSession {
  id: string;
  ownerUid: string;
  title: string;
  persona: HrAssistantPersona;
  model: AllowedGeminiModel;
  status: 'active' | 'archived';
  messageCount: number;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface StoredChatMessage {
  id: string;
  ownerUid: string;
  sessionId: string;
  sender: 'user' | 'assistant';
  content: string;
  model: string;
  createdAtMs: number;
}

export interface StoredHrNote {
  id: string;
  ownerUid: string;
  title: string;
  category: HrNoteCategory;
  body: string;
  status: 'open' | 'resolved';
  createdAtMs: number;
  updatedAtMs: number;
}

function toMillis(value: unknown): number {
  if (value && typeof value === 'object' && 'toMillis' in value && typeof (value as Timestamp).toMillis === 'function') {
    return (value as Timestamp).toMillis();
  }
  if (typeof value === 'number') return value;
  return Date.now();
}

function makeSafeDocId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10).replace(/[^a-zA-Z0-9]/g, '');
  return `${prefix}_${Date.now()}_${rand || 'id'}`;
}

function clampString(value: string, maxLength: number, fallback: string): string {
  const cleaned = value.trim();
  if (!cleaned) return fallback;
  return cleaned.length > maxLength ? cleaned.slice(0, maxLength) : cleaned;
}

export function subscribeFirebaseAuth(callback: (user: FirebaseUser | null) => void): Unsubscribe {
  void testFirestoreConnection();
  return onAuthStateChanged(firebaseAuth, callback);
}

export async function signInWithGoogleFirebase(): Promise<FirebaseUser> {
  const credential = await signInWithPopup(firebaseAuth, googleProvider);
  await ensureFirestoreUserProfile(credential.user);
  return credential.user;
}

export async function signOutFirebase(): Promise<void> {
  if (firebaseAuth.currentUser) {
    await signOut(firebaseAuth);
  }
}

export async function ensureFirestoreUserProfile(user: FirebaseUser): Promise<void> {
  const path = `users/${user.uid}`;
  const userRef = doc(firestoreDb, 'users', user.uid);
  const displayName = clampString(user.displayName || user.email?.split('@')[0] || 'Workspace Member', 120, 'Workspace Member');
  const email = clampString(user.email || '', 160, 'member@nexushrm.com');

  try {
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(userRef, {
        uid: user.uid,
        displayName,
        email,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(userRef, {
        displayName,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export function subscribeChatSessions(
  uid: string,
  onData: (sessions: StoredChatSession[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = `users/${uid}/chatSessions`;
  const q = query(collection(firestoreDb, 'users', uid, 'chatSessions'), where('ownerUid', '==', uid));

  return onSnapshot(
    q,
    (snapshot) => {
      const rows: StoredChatSession[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ownerUid: String(data.ownerUid || uid),
          title: String(data.title || 'Untitled Conversation'),
          persona: (data.persona as HrAssistantPersona) || 'hr_advisor',
          model: (data.model as AllowedGeminiModel) || 'gemini-4-hydrogen',
          status: data.status === 'archived' ? 'archived' : 'active',
          messageCount: typeof data.messageCount === 'number' ? data.messageCount : 0,
          createdAtMs: toMillis(data.createdAt),
          updatedAtMs: toMillis(data.updatedAt),
        };
      });
      rows.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
      onData(rows);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
        }
      }
    }
  );
}

export function subscribeChatMessages(
  uid: string,
  sessionId: string,
  onData: (messages: StoredChatMessage[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = `users/${uid}/chatSessions/${sessionId}/messages`;
  const q = query(
    collection(firestoreDb, 'users', uid, 'chatSessions', sessionId, 'messages'),
    where('ownerUid', '==', uid)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const rows: StoredChatMessage[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ownerUid: String(data.ownerUid || uid),
          sessionId: String(data.sessionId || sessionId),
          sender: data.sender === 'assistant' ? 'assistant' : 'user',
          content: String(data.content || ''),
          model: String(data.model || 'gemini-4-hydrogen'),
          createdAtMs: toMillis(data.createdAt),
        };
      });
      rows.sort((a, b) => a.createdAtMs - b.createdAtMs);
      onData(rows);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
        }
      }
    }
  );
}

export async function createFirestoreChatSession(
  uid: string,
  params: { title: string; persona: HrAssistantPersona; model: AllowedGeminiModel }
): Promise<string> {
  const sessionId = makeSafeDocId('sess');
  const path = `users/${uid}/chatSessions/${sessionId}`;
  try {
    await setDoc(doc(firestoreDb, 'users', uid, 'chatSessions', sessionId), {
      ownerUid: uid,
      title: clampString(params.title, 160, 'HR Assistant Conversation'),
      persona: params.persona,
      model: params.model,
      status: 'active',
      messageCount: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return sessionId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function appendFirestoreChatMessage(
  uid: string,
  sessionId: string,
  params: {
    sender: 'user' | 'assistant';
    content: string;
    model: AllowedGeminiModel;
    nextMessageCount: number;
    updatedTitle?: string;
    persona?: HrAssistantPersona;
  }
): Promise<string> {
  const messageId = makeSafeDocId('msg');
  const msgPath = `users/${uid}/chatSessions/${sessionId}/messages/${messageId}`;
  const sessionPath = `users/${uid}/chatSessions/${sessionId}`;
  try {
    await setDoc(doc(firestoreDb, 'users', uid, 'chatSessions', sessionId, 'messages', messageId), {
      ownerUid: uid,
      sessionId,
      sender: params.sender,
      content: clampString(params.content, 16000, '...'),
      model: clampString(params.model, 60, 'gemini-4-hydrogen'),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, msgPath);
  }

  try {
    const patch: Record<string, unknown> = {
      messageCount: Math.min(5000, Math.max(0, Math.floor(params.nextMessageCount))),
      model: params.model,
      updatedAt: serverTimestamp(),
    };
    if (params.updatedTitle) {
      patch.title = clampString(params.updatedTitle, 160, 'HR Assistant Conversation');
    }
    if (params.persona) {
      patch.persona = params.persona;
    }
    await updateDoc(doc(firestoreDb, 'users', uid, 'chatSessions', sessionId), patch);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, sessionPath);
  }

  return messageId;
}

export async function archiveFirestoreChatSession(uid: string, sessionId: string): Promise<void> {
  const path = `users/${uid}/chatSessions/${sessionId}`;
  try {
    await updateDoc(doc(firestoreDb, 'users', uid, 'chatSessions', sessionId), {
      status: 'archived',
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteFirestoreChatSession(uid: string, sessionId: string): Promise<void> {
  const path = `users/${uid}/chatSessions/${sessionId}`;
  try {
    await deleteDoc(doc(firestoreDb, 'users', uid, 'chatSessions', sessionId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export function subscribeHrNotes(
  uid: string,
  onData: (notes: StoredHrNote[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = `users/${uid}/hrNotes`;
  const q = query(collection(firestoreDb, 'users', uid, 'hrNotes'), where('ownerUid', '==', uid));

  return onSnapshot(
    q,
    (snapshot) => {
      const rows: StoredHrNote[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ownerUid: String(data.ownerUid || uid),
          title: String(data.title || 'HR Note'),
          category: (data.category as HrNoteCategory) || 'General',
          body: String(data.body || ''),
          status: data.status === 'resolved' ? 'resolved' : 'open',
          createdAtMs: toMillis(data.createdAt),
          updatedAtMs: toMillis(data.updatedAt),
        };
      });
      rows.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
      onData(rows);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
        }
      }
    }
  );
}

export async function createFirestoreHrNote(
  uid: string,
  params: { title: string; category: HrNoteCategory; body: string }
): Promise<string> {
  const noteId = makeSafeDocId('note');
  const path = `users/${uid}/hrNotes/${noteId}`;
  try {
    await setDoc(doc(firestoreDb, 'users', uid, 'hrNotes', noteId), {
      ownerUid: uid,
      title: clampString(params.title, 160, 'HR Note'),
      category: params.category,
      body: clampString(params.body, 4000, 'Saved note'),
      status: 'open',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return noteId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function resolveFirestoreHrNote(uid: string, noteId: string): Promise<void> {
  const path = `users/${uid}/hrNotes/${noteId}`;
  try {
    await updateDoc(doc(firestoreDb, 'users', uid, 'hrNotes', noteId), {
      status: 'resolved',
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteFirestoreHrNote(uid: string, noteId: string): Promise<void> {
  const path = `users/${uid}/hrNotes/${noteId}`;
  try {
    await deleteDoc(doc(firestoreDb, 'users', uid, 'hrNotes', noteId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}
