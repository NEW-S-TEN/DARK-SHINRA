// anti-delete.js
import pkg from '@whiskeysockets/baileys';
const { proto, downloadContentFromMessage } = pkg;
import config from '../config.cjs';
import fs from 'fs';
import path from 'path';

// === Constantes ===
const DB_FILE = path.join(process.cwd(), "antidelete.json");

// === Classe principale du système anti-suppression ===
class AntiDeleteSystem {
  constructor() {
    this.enabled = config.ANTI_DELETE || false;
    this.cacheExpiry = 30 * 60 * 1000; // 30 minutes
    this.messageCache = new Map();
    this.cleanupTimer = null;
    this.isSaving = false;
    this.saveQueue = [];

    this.loadDatabase();
    this.startCleanup();
    console.log("🛡️ Anti-Delete System Initialized");
  }

  // Chargement des messages sauvegardés
  async loadDatabase() {
    try {
      if (fs.existsSync(DB_FILE)) {
        const data = await fs.promises.readFile(DB_FILE, 'utf8');
        const entries = JSON.parse(data);
        const now = Date.now();
        const validEntries = entries.filter(([_, msg]) => now - msg.timestamp <= this.cacheExpiry);
        this.messageCache = new Map(validEntries);
        console.log(`📦 Loaded ${validEntries.length} messages from database`);
        if (entries.length !== validEntries.length) await this.saveDatabase();
      }
    } catch (err) {
      console.error("🔴 Failed to load database:", err);
    }
  }

  // Sauvegarde de la base de données
  async saveDatabase() {
    if (this.isSaving) {
      return new Promise(resolve => this.saveQueue.push(resolve));
    }
    this.isSaving = true;

    try {
      const data = JSON.stringify(Array.from(this.messageCache.entries()));
      await fs.promises.writeFile(DB_FILE, data);
      console.log(`💾 Database saved (${this.messageCache.size} messages)`);
      while (this.saveQueue.length) {
        const resolve = this.saveQueue.shift();
        resolve();
      }
    } catch (err) {
      console.error("🔴 Error saving database:", err);
    } finally {
      this.isSaving = false;
    }
  }

  // Ajout d’un message au cache
  async addMessage(id, message) {
    if (this.messageCache.size > 1000) this.cleanExpiredMessages(true);
    this.messageCache.set(id, message);
    console.log(`📥 Cached message: ${id}`);
    await this.saveDatabase();
  }

  // Suppression d’un message du cache
  async deleteMessage(id) {
    if (this.messageCache.has(id)) {
      this.messageCache.delete(id);
      console.log(`🗑️ Removed from cache: ${id}`);
      await this.saveDatabase();
    }
  }

  // Nettoyage des anciens messages
  cleanExpiredMessages(force = false) {
    const now = Date.now();
    let count = 0;
    const limit = force ? this.messageCache.size : Math.min(100, this.messageCache.size);
    for (const [key, msg] of this.messageCache.entries()) {
      if (now - msg.timestamp > this.cacheExpiry) {
        this.messageCache.delete(key);
        count++;
      }
      if (!force && count >= limit) break;
    }
    if (count > 0) {
      console.log(`🧹 Cleaned ${count} expired messages`);
      this.saveDatabase();
    }
  }

  // Démarre le nettoyeur automatique
  startCleanup() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = setInterval(() => this.cleanExpiredMessages(), Math.min(this.cacheExpiry, 300000));
    console.log("⏰ Cleanup scheduler started");
  }

  // Format de l’heure pour les logs
  formatTime(timestamp) {
    return new Date(timestamp).toLocaleString('en-PK', {
      timeZone: "America/Port-au-Prince",
      dateStyle: 'medium',
      timeStyle: 'medium',
      hour12: true
    }) + " (PKT)";
  }

  // Arrêt du système
  async destroy() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    await this.saveDatabase();
  }
}

const antiDelete = new AntiDeleteSystem();

// === Fonction principale d'intégration au bot ===
const AntiDelete = async (m, Matrix) => {
  const prefix = config.PREFIX;
  const botNumber = await Matrix.decodeJid(Matrix.user.id);
  const isCreator = [botNumber, config.OWNER_NUMBER + '@s.whatsapp.net'].includes(m.sender);
  const args = m.body?.slice(prefix.length).trim().split(" ") || [];
  const cmd = args[0]?.toLowerCase();
  const subcmd = args[1]?.toLowerCase();

  const getChatInfo = async jid => {
    if (!jid) return { name: "🚫 Unknown Chat", isGroup: false };
    try {
      if (jid.includes("@g.us")) {
        const meta = await Matrix.groupMetadata(jid);
        return { name: meta.subject || "👥 Group", isGroup: true };
      }
      return { name: "👤 Private Chat", isGroup: false };
    } catch {
      return { name: "🚫 Unknown Chat", isGroup: false };
    }
  };

  if (cmd === "antidelete" && isCreator) {
    const modes = {
      same: "🔄 Same Chat",
      inbox: "📥 Bot Inbox",
      owner: "👑 Owner PM"
    };
    const currentMode = modes[config.ANTI_DELETE_PATH] || modes.owner;
    const responses = {
      on: `🌟 *Anti-Delete Activated*
• Status: 🟢 Active
• Mode: ${currentMode}
• Cache Duration: 30min
• Messages Stored: ${antiDelete.messageCache.size}`,
      off: `⚠️ *Anti-Delete Deactivated*
• Status: 🔴 Inactive
• Cache cleared`,
      stats: `📊 *Anti-Delete Stats*
• Status: ${antiDelete.enabled ? "🟢 Active" : "🔴 Inactive"}
• Mode: ${currentMode}
• Messages Cached: ${antiDelete.messageCache.size}`,
      help: `🛡️ *Anti-Delete Help*
• ${prefix}antidelete on
• ${prefix}antidelete off
• ${prefix}antidelete stats`
    };

    switch (subcmd) {
      case 'on':
        antiDelete.enabled = true;
        antiDelete.startCleanup();
        await m.reply(responses.on);
        await m.React('🛡️');
        break;
      case 'off':
        antiDelete.enabled = false;
        antiDelete.messageCache.clear();
        await antiDelete.saveDatabase();
        await m.reply(responses.off);
        await m.React('⚠️');
        break;
      case 'stats':
        await m.reply(responses.stats);
        await m.React('📊');
        break;
      default:
        await m.reply(responses.help);
        await m.React('ℹ️');
    }
    return;
  }

  // === Interception des messages ===
  Matrix.ev.on("messages.upsert", async ({ messages, type }) => {
    if (!antiDelete.enabled || type !== 'notify') return;
    for (const msg of messages || []) {
      try {
        if (msg.key.fromMe || msg.key.remoteJid === 'status@broadcast') continue;
        if (msg.message.audioMessage?.ptt) {
          const stream = await downloadContentFromMessage(msg.message.audioMessage, 'audio');
          const mediaBuffer = await collectStream(stream);
          const entry = {
            type: 'ptt',
            media: mediaBuffer,
            mimetype: msg.message.audioMessage.mimetype || "audio/ogg",
            sender: msg.key.participant || msg.key.remoteJid,
            senderFormatted: '@' + (msg.key.participant || msg.key.remoteJid).replace(/@.+$/, ''),
            timestamp: Date.now(),
            chatJid: msg.key.remoteJid
          };
          await antiDelete.addMessage(msg.key.id, entry);
          continue;
        }
        // Future: handle other types (images, texts, etc.)
      } catch (err) {
        console.error("📥 Error caching message:", err);
      }
    }
  });

  // === Réaction à une suppression de message ===
  Matrix.ev.on("messages.update", async updates => {
    if (!antiDelete.enabled || !updates?.length) return;
    for (const update of updates) {
      try {
        const { key, update: status } = update;
        const isDeleted = status?.messageStubType === proto.WebMessageInfo.StubType.REVOKE ||
                          status?.status === proto.WebMessageInfo.Status.DELETED;
        if (!isDeleted || key.fromMe || !antiDelete.messageCache.has(key.id)) continue;

        const cached = antiDelete.messageCache.get(key.id);
        await antiDelete.deleteMessage(key.id);

        // Où envoyer le message récupéré ?
        let destination;
        switch (config.ANTI_DELETE_PATH) {
          case 'same': destination = key.remoteJid; break;
          case 'inbox': destination = Matrix.user.id; break;
          default: destination = config.OWNER_NUMBER + '@s.whatsapp.net';
        }

        // Alerte
        await Matrix.sendMessage(destination, {
          text: `🚨 *Recovered Deleted Message*
▫️ *Sender:* ${cached.senderFormatted}
▫️ *Chat:* ${(await getChatInfo(cached.chatJid)).name}
🕒 *Time:* ${antiDelete.formatTime(cached.timestamp)}`
        });

        // Restauration du média
        if (cached.type === 'ptt') {
          await Matrix.sendMessage(destination, {
            audio: cached.media,
            mimetype: cached.mimetype,
            ptt: true
          });
        } else if (cached.media) {
          await Matrix.sendMessage(destination, {
            [cached.type]: cached.media,
            mimetype: cached.mimetype
          });
        }

        // Restauration du texte
        if (cached.content) {
          await Matrix.sendMessage(destination, {
            text: `📝 *Content:*\n${cached.content}`
          });
        }

        await Matrix.sendReaction(destination, { id: key.id, remoteJid: key.remoteJid }, '✅');

      } catch (err) {
        console.error("🔴 Error restoring message:", err);
        await Matrix.sendReaction(destination, { id: key.id, remoteJid: key.remoteJid }, '❌');
      }
    }
  });
};

// Fonction utilitaire pour lire les flux
async function collectStream(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export default AntiDelete;