const SUCCESS_CUE_SRC = "/assets/audio/sfx/victory-mandarin-applause.mp3";
const SUCCESS_CUE_VOLUME = 0.34;

export class SuccessCue {
  private audio?: HTMLAudioElement;

  preload() {
    const audio = this.getAudio();
    if (!audio) return;
    audio.preload = "auto";
    audio.load();
  }

  play() {
    const audio = this.getAudio();
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    audio.volume = SUCCESS_CUE_VOLUME;
    void audio.play().catch(() => {
      // Keep the success flow moving if browser autoplay rules block the cue.
    });
  }

  stop() {
    if (!this.audio) return;
    this.audio.pause();
    this.audio.currentTime = 0;
  }

  private getAudio() {
    if (this.audio) return this.audio;
    if (typeof Audio === "undefined") return undefined;
    const audio = new Audio(SUCCESS_CUE_SRC);
    audio.preload = "auto";
    audio.volume = SUCCESS_CUE_VOLUME;
    this.audio = audio;
    return audio;
  }
}
