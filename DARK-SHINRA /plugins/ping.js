import config from '../config.cjs';

const ping = async (m, Matrix) => {
  const prefix = config.PREFIX;
  const cmd = m.body.startsWith(prefix) ? m.body.slice(prefix.length).split(' ')[0].toLowerCase() : '';

  if (cmd === "ping") {
    const start = new Date().getTime();

    const emojis = ['🔥', '⚡', '🚀', '💨', '🎯', '🎉', '🌟', '💥', '🕐', '🔹', '💎', '🏆', '🎶', '🌠', '🌀', '🔱', '🛡️', '✨'];
    const emoji = emojis[Math.floor(Math.random() * emojis.length)];

    await m.React(emoji);

    const end = new Date().getTime();
    const responseTime = (end - start) / 1000;

    const message = `*𝘿𝘼𝙍𝙆-𝙎𝙃𝙄𝙉𝙍𝘼 SPEED:* ${responseTime.toFixed(2)}s ${emoji}\n\n` +
                    `Rejoins le canal officiel ici:\n` +
                    `https://whatsapp.com/channel/0029Vakp0UnICVfe3I2Fe72w`;

    await Matrix.sendMessage(m.from, {
      text: message,
      contextInfo: {
        mentionedJid: [m.sender]
      }
    }, { quoted: m });
  }
};

export default ping;
