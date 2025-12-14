import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'

type FirebaseConfig = {
  apiKey: string
  authDomain: string
  projectId: string
  appId: string
}

let app: FirebaseApp | null = null
let auth: Auth | null = null

function getFirebaseConfig(): FirebaseConfig {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY as string | undefined
  const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined
  const appId = import.meta.env.VITE_FIREBASE_APP_ID as string | undefined

  if (!apiKey || !authDomain || !projectId || !appId) {
    throw new Error('Missing Firebase env vars (VITE_FIREBASE_*)')
  }

  return { apiKey, authDomain, projectId, appId }
}

export function getFirebaseAuth(): Auth {
  if (!app) {
    app = initializeApp(getFirebaseConfig())
  }

  if (!auth) {
    auth = getAuth(app)
  }

  return auth
}
