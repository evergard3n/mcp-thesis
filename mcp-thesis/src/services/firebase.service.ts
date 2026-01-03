import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  addDoc,
  collection,
  Firestore,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  where,
} from "firebase/firestore";
import {
  API_KEY,
  APP_ID,
  AUTH_DOMAIN,
  MEASUREMENT_ID,
  MESSAGING_SENDER_ID,
  PROJECT_ID,
  STORAGE_BUCKET,
} from "../helpers/env.js";

class FirebaseService {
  private firebaseConfig = {
    apiKey: API_KEY,
    authDomain: AUTH_DOMAIN,
    projectId: PROJECT_ID,
    storageBucket: STORAGE_BUCKET,
    messagingSenderId: MESSAGING_SENDER_ID,
    appId: APP_ID,
    measurementId: MEASUREMENT_ID,
  };
  private app: FirebaseApp;
  private db: Firestore;
  constructor() {
    this.app = initializeApp(this.firebaseConfig);
    this.db = getFirestore(this.app);
  }

  getFirestore() {
    return this.db;
  }

  // Add a document with auto-generated ID
  async addDocument(collectionName: string, data: any) {
    try {
      const docRef = await addDoc(collection(this.db, collectionName), data);
      console.log("Document written with ID: ", docRef.id);
      return docRef.id;
    } catch (e) {
      console.error("Error adding document: ", e);
      throw e;
    }
  }

  // Set a document with a specific ID (creates or overwrites)
  async setDocument(collectionName: string, docId: string, data: any) {
    try {
      const docRef = doc(this.db, collectionName, docId);
      await setDoc(docRef, data);
      console.log("Document set with ID: ", docId);
      return docId;
    } catch (e) {
      console.error("Error setting document: ", e);
      throw e;
    }
  }

  // Update an existing document
  async updateDocument(collectionName: string, docId: string, data: any) {
    try {
      const docRef = doc(this.db, collectionName, docId);
      await updateDoc(docRef, data);
      console.log("Document updated with ID: ", docId);
    } catch (e) {
      console.error("Error updating document: ", e);
      throw e;
    }
  }

  // Get a document by ID
  async getDocument(collectionName: string, docId: string) {
    try {
      const docRef = doc(this.db, collectionName, docId);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        return { id: docSnap.id, ...docSnap.data() };
      } else {
        console.log("No such document!");
        return null;
      }
    } catch (e) {
      console.error("Error getting document: ", e);
      throw e;
    }
  }

  // Delete a document by ID
  async deleteDocument(collectionName: string, docId: string) {
    try {
      const docRef = doc(this.db, collectionName, docId);
      await deleteDoc(docRef);
      console.log("Document deleted with ID: ", docId);
    } catch (e) {
      console.error("Error deleting document: ", e);
      throw e;
    }
  }

  // Get all documents in a collection
  async getAllDocuments(collectionName: string) {
    try {
      const querySnapshot = await getDocs(collection(this.db, collectionName));
      return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (e) {
      console.error("Error getting documents: ", e);
      throw e;
    }
  }

  // Query documents by field value
  async queryDocuments(collectionName: string, field: string, operator: any, value: any) {
    try {
      const q = query(
        collection(this.db, collectionName),
        where(field, operator, value)
      );
      const querySnapshot = await getDocs(q);
      return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (e) {
      console.error("Error querying documents: ", e);
      throw e;
    }
  }

  // Get newest document in a collection
  async getNewestDoc(collectionName: string) {
    try {
      const q = query(
        collection(this.db, collectionName),
        orderBy("createdAt", "desc"),
        limit(1)
      );

      const querySnapshot = await getDocs(q);

      if (!querySnapshot.empty) {
        const newestDoc = querySnapshot.docs[0];
        console.log("Newest Doc ID:", newestDoc.id);
        console.log("Newest Doc Data:", newestDoc.data());
        return { id: newestDoc.id, ...newestDoc.data() };
      } else {
        console.log("Collection is empty.");
        return null;
      }
    } catch (e) {
      console.error("Error getting newest document: ", e);
      throw e;
    }
  }

  // Add a log entry
  async addLog(sessionId: string, projectId: string, message: string) {
    try {
      const logData = {
        sessionId,
        projectId,
        message,
        timestamp: new Date().toISOString(),
      };
      await this.addDocument("logs", logData);
    } catch (e) {
      console.error("Error adding log: ", e);
      throw e;
    }
  }
}

export default new FirebaseService();
