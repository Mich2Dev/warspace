import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Conectar a la base de datos (se crea el archivo si no existe)
const db = new Database(path.join(__dirname, 'galaxy.db'), { verbose: console.log });

// Inicializar Tablas
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    clan_id TEXT,
    credits INTEGER DEFAULT 0,
    xp INTEGER DEFAULT 0,
    hp INTEGER DEFAULT 100,
    pos_x REAL DEFAULT 0,
    pos_y REAL DEFAULT 0,
    pos_z REAL DEFAULT 0,
    rot_x REAL DEFAULT 0,
    rot_y REAL DEFAULT 0,
    rot_z REAL DEFAULT 0,
    rot_w REAL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS clans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    leader_id INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS friends (
    user_id_1 INTEGER NOT NULL,
    user_id_2 INTEGER NOT NULL,
    PRIMARY KEY (user_id_1, user_id_2)
  );
`);

// Prepared Statements para rendimiento
const stmtLogin = db.prepare('SELECT * FROM users WHERE username = ? AND password = ?');
// Earth spawn coords: x=6000000, y=30000, z=0
const stmtRegister = db.prepare('INSERT INTO users (username, password, pos_x, pos_y, pos_z) VALUES (?, ?, 6000000, 30000, 0)');
const stmtSavePos = db.prepare('UPDATE users SET pos_x = ?, pos_y = ?, pos_z = ?, rot_x = ?, rot_y = ?, rot_z = ?, rot_w = ?, hp = ?, clan_id = ? WHERE id = ?');
const stmtGetById = db.prepare('SELECT * FROM users WHERE id = ?');
const stmtGetByUsername = db.prepare('SELECT * FROM users WHERE username = ?');

export const database = {
  login: (username, password) => {
    return stmtLogin.get(username, password);
  },

  userExists: (username) => {
    return stmtGetByUsername.get(username) !== undefined;
  },
  
  register: (username, password) => {
    try {
      const result = stmtRegister.run(username, password);
      return stmtGetById.get(result.lastInsertRowid);
    } catch (err) {
      // Usualmente falla si el usuario ya existe (UNIQUE constraint)
      return null;
    }
  },

  savePlayerState: (playerData) => {
    if (!playerData.dbId) return;
    stmtSavePos.run(
      playerData.position.x, playerData.position.y, playerData.position.z,
      playerData.rotation.x, playerData.rotation.y, playerData.rotation.z, playerData.rotation.w,
      playerData.hp,
      playerData.clanId,
      playerData.dbId
    );
  }
};
