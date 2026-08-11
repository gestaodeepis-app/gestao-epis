// Copie este arquivo para firebase-config.js e preencha com os dados do seu projeto.
export const firebaseConfig = {
  apiKey: "SUA_API_KEY",
  authDomain: "SEU_PROJETO.firebaseapp.com",
  projectId: "SEU_PROJETO",
  storageBucket: "SEU_PROJETO.appspot.com",
  messagingSenderId: "SEU_SENDER_ID",
  appId: "SEU_APP_ID"
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
