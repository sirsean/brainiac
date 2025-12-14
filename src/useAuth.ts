import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  GoogleAuthProvider,
  type User,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
} from 'firebase/auth'

import { getFirebaseAuth } from './firebase'

type UseAuthState = {
  loading: boolean
  user: User | null
  signIn: () => Promise<void>
  signOut: () => Promise<void>
  getIdToken: () => Promise<string | null>
}

export function useAuth(): UseAuthState {
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => {
    const auth = getFirebaseAuth()

    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u)
      setLoading(false)
    })

    return () => unsub()
  }, [])

  const signIn = useCallback(async () => {
    const auth = getFirebaseAuth()
    const provider = new GoogleAuthProvider()
    await signInWithPopup(auth, provider)
  }, [])

  const signOut = useCallback(async () => {
    const auth = getFirebaseAuth()
    await firebaseSignOut(auth)
  }, [])

  const getIdToken = useCallback(async () => {
    if (!user) return null
    return await user.getIdToken()
  }, [user])

  return useMemo(
    () => ({
      loading,
      user,
      signIn,
      signOut,
      getIdToken,
    }),
    [getIdToken, loading, signIn, signOut, user],
  )
}
