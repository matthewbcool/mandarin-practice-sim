const RADIO_TRACKS = [
  {
    id: "rainy-afternoon-chords",
    title: "Rainy Afternoon Chords",
    src: "/assets/audio/radio/rainy-afternoon-chords.mp3",
  },
  {
    id: "rainy-day-thoughts",
    title: "Rainy Day Thoughts",
    src: "/assets/audio/radio/rainy-day-thoughts.mp3",
  },
  {
    id: "midnight-jazz-cafe",
    title: "Midnight Jazz Cafe",
    src: "/assets/audio/radio/midnight-jazz-cafe.mp3",
  },
] as const;

const RADIO_VOLUME = 0.09;
const DUCKED_VOLUME = 0.026;
const DUCK_FADE_MS = 180;
const TRACK_CROSSFADE_MS = 1200;

export class ShopRadio {
  private currentAudio?: HTMLAudioElement;
  private nextAudio?: HTMLAudioElement;
  private currentTrackIndex = -1;
  private ducked = false;
  private started = false;
  private fadeIds = new Map<HTMLAudioElement, number>();

  start() {
    if (!this.currentAudio) {
      this.currentTrackIndex = randomTrackIndex();
      this.currentAudio = this.createAudio(this.currentTrackIndex);
      this.currentAudio.volume = this.targetVolume();
      this.prepareNextTrack();
    }

    this.started = true;
    void this.currentAudio.play().catch(() => {
      // Browser autoplay rules can still block in headless/test contexts.
    });
  }

  duck(active: boolean) {
    this.ducked = active;
    if (!this.currentAudio) return;
    this.fadeAudio(this.currentAudio, this.targetVolume(), DUCK_FADE_MS);
    if (this.nextAudio) this.nextAudio.volume = 0;
  }

  nextTrack() {
    if (!this.currentAudio) {
      this.start();
      return;
    }

    const fromAudio = this.currentAudio;
    const toIndex = this.nextTrackIndex();
    const toAudio = this.nextAudio?.dataset.trackIndex === String(toIndex) ? this.nextAudio : this.createAudio(toIndex);

    this.currentTrackIndex = toIndex;
    this.currentAudio = toAudio;
    this.nextAudio = undefined;

    toAudio.currentTime = 0;
    toAudio.volume = 0;
    void toAudio.play().catch(() => {
      this.skipFailedTrack();
    });

    this.fadeAudio(fromAudio, 0, TRACK_CROSSFADE_MS, () => {
      fromAudio.pause();
      fromAudio.src = "";
      fromAudio.load();
    });
    this.fadeAudio(toAudio, this.targetVolume(), TRACK_CROSSFADE_MS);
    this.prepareNextTrack();
  }

  stop() {
    this.fadeIds.forEach((fadeId) => window.clearInterval(fadeId));
    this.fadeIds.clear();
    this.currentAudio?.pause();
    this.nextAudio?.pause();
    this.currentAudio = undefined;
    this.nextAudio = undefined;
    this.currentTrackIndex = -1;
    this.started = false;
  }

  private createAudio(trackIndex: number) {
    const audio = new Audio(RADIO_TRACKS[trackIndex].src);
    audio.dataset.trackIndex = String(trackIndex);
    audio.loop = false;
    audio.preload = "auto";
    audio.volume = 0;
    audio.addEventListener("ended", () => {
      if (audio === this.currentAudio) this.nextTrack();
    });
    audio.addEventListener("error", () => {
      if (audio === this.currentAudio) this.skipFailedTrack();
    });
    return audio;
  }

  private prepareNextTrack() {
    const nextIndex = this.nextTrackIndex();
    if (this.nextAudio?.dataset.trackIndex === String(nextIndex)) return;
    this.nextAudio?.pause();
    this.nextAudio = this.createAudio(nextIndex);
    this.nextAudio.preload = "auto";
    this.nextAudio.load();
  }

  private skipFailedTrack() {
    if (!this.currentAudio || RADIO_TRACKS.length < 2) return;
    const failedAudio = this.currentAudio;
    failedAudio.pause();
    this.currentTrackIndex = this.nextTrackIndex();
    this.currentAudio = this.createAudio(this.currentTrackIndex);
    this.currentAudio.volume = this.targetVolume();
    if (this.started) {
      void this.currentAudio.play().catch(() => {
        // If every track is unavailable, keep the radio silent.
      });
    }
    this.prepareNextTrack();
  }

  private nextTrackIndex() {
    if (this.currentTrackIndex < 0) return 0;
    return (this.currentTrackIndex + 1) % RADIO_TRACKS.length;
  }

  private targetVolume() {
    return this.ducked ? DUCKED_VOLUME : RADIO_VOLUME;
  }

  private fadeAudio(audio: HTMLAudioElement, target: number, durationMs: number, onDone?: () => void) {
    const activeFade = this.fadeIds.get(audio);
    if (activeFade) window.clearInterval(activeFade);

    const start = audio.volume;
    const startedAt = performance.now();
    const fadeId = window.setInterval(() => {
      const progress = Math.min(1, (performance.now() - startedAt) / durationMs);
      audio.volume = start + (target - start) * progress;
      if (progress >= 1) {
        window.clearInterval(fadeId);
        this.fadeIds.delete(audio);
        audio.volume = target;
        onDone?.();
      }
    }, 16);
    this.fadeIds.set(audio, fadeId);
  }
}

function randomTrackIndex() {
  return Math.floor(Math.random() * RADIO_TRACKS.length);
}
