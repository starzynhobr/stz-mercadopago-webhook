import { cert, getApps, initializeApp } from "firebase-admin/app"
import { getFirestore, type Firestore } from "firebase-admin/firestore"

let firestoreInstance: Firestore | null = null

function getDbInstance() {
  if (firestoreInstance) {
    return firestoreInstance
  }

  const projectId = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n")

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Missing Firebase Admin environment variables: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY",
    )
  }

  const app =
    getApps()[0] ??
    initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    })

  firestoreInstance = getFirestore(app)

  return firestoreInstance
}

export const db = new Proxy({} as Firestore, {
  get(_target, prop, receiver) {
    const instance = getDbInstance()
    const value = Reflect.get(instance as object, prop, receiver)

    return typeof value === "function" ? value.bind(instance) : value
  },
})
