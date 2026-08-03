// Copie este arquivo para firebase-config.js e preencha com os dados do seu projeto.
export const firebaseConfig = {
    apiKey: "AIzaSyBELkl5XVtzIjj0H1tJhngZmETi3GH6rFM",
  authDomain: "gestaodeepis-6693f.firebaseapp.com",
  projectId: "gestaodeepis-6693f",
  storageBucket: "gestaodeepis-6693f.firebasestorage.app",
  messagingSenderId: "652716663927",
  appId: "1:652716663927:web:99096129a2b1cb4a741272",
  measurementId: "G-P9CH9WVNHY"
};

/*
Estrutura Firestore recomendada:
system/ownership
users/{uid}
plants/{plantId}
employees/{employeeId}
epis/{epiId}
stock/{plantId_epiId}
movements/{movementId}
auditLogs/{logId}
notifications/{notificationId}
*/
