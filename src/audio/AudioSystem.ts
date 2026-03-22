export class AudioSystem {
  private context: AudioContext | null = null;

  async unlock(): Promise<void> {
    if (!this.context) {
      this.context = new AudioContext();
    }

    if (this.context.state !== 'running') {
      await this.context.resume();
    }
  }

  playCrystalPickup(): void {
    if (!this.context || this.context.state !== 'running') {
      return;
    }

    const start = this.context.currentTime;
    const gain = this.context.createGain();
    gain.connect(this.context.destination);
    gain.gain.setValueAtTime(0.001, start);
    gain.gain.exponentialRampToValueAtTime(0.09, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.2);

    const notes = [659.25, 987.77, 1318.51];
    notes.forEach((frequency, index) => {
      const osc = this.context!.createOscillator();
      const oscGain = this.context!.createGain();

      osc.type = index === 0 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(frequency, start);
      osc.frequency.exponentialRampToValueAtTime(frequency * 1.18, start + 0.35);

      oscGain.gain.setValueAtTime(0.0001, start);
      oscGain.gain.exponentialRampToValueAtTime(0.05 / (index + 1), start + 0.04);
      oscGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.6 + index * 0.12);

      osc.connect(oscGain);
      oscGain.connect(gain);
      osc.start(start + index * 0.03);
      osc.stop(start + 0.8 + index * 0.1);
    });
  }
}
