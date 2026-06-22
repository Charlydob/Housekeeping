// Configuración Firebase para HTML/CSS/JS simple con GitHub Pages.
// Usa los scripts compat cargados en index.html.

window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyD9cOTGsB3wBkRccfa45XRGTnyaxRDy-UU",
  authDomain: "housekeeping-e295d.firebaseapp.com",
  projectId: "housekeeping-e295d",
  storageBucket: "housekeeping-e295d.firebasestorage.app",
  messagingSenderId: "395725116080",
  appId: "1:395725116080:web:fb7093a73cfd9134902175",

  // Necesario para Realtime Database.
  // Si aún no creaste la base de datos, déjalo vacío hasta crearla.
  databaseURL: "https://housekeeping-e295d-default-rtdb.europe-west1.firebasedatabase.app"
};

// Ruta donde se guardarán las habitaciones.
window.FIREBASE_DB_PATH = "housekeeping/rooms";