// Copie este arquivo para firebase-config.js e preencha com os dados do seu projeto.
export const firebaseConfig = {
  apiKey: "SUA_API_KEY_REAL",
  authDomain: "gestaodeepis-6693f.firebaseapp.com",
  projectId: "gestaodeepis-6693f",
  storageBucket: "gestaodeepis-6693f.firebasestorage.app",
  messagingSenderId: "SEU_NUMERO",
  appId: "SEU_APP_ID",
  measurementId: "SEU_MEASUREMENT_ID"
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
