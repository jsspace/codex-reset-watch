chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message.target !== 'offscreen' || message.type !== 'play') return;
  (async () => {
    const context = new AudioContext();
    try {
      await context.resume();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(660, context.currentTime);
      oscillator.frequency.setValueAtTime(880, context.currentTime + 0.15);
      gain.gain.setValueAtTime(0.08, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.45);
      oscillator.connect(gain).connect(context.destination);
      const ended = new Promise(resolve => oscillator.onended = resolve);
      oscillator.start(); oscillator.stop(context.currentTime + 0.5);
      await ended;
      respond({ ok: true });
    } finally { await context.close(); }
  })().catch(error => respond({ error: error.message }));
  return true;
});
