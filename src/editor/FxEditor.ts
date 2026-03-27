import { FX_SETTINGS_STORAGE_KEY, type FxSettings } from '../fx/FxSettings';

type SliderConfig = {
  key:
    | 'exposure'
    | 'contrast'
    | 'saturation'
    | 'vignette'
    | 'bloom.strength'
    | 'bloom.radius'
    | 'bloom.threshold'
    | 'motionBlur.intensity'
    | 'gamepad.moveSpeedX'
    | 'gamepad.moveSpeedY'
    | 'gamepad.lookSpeedX'
    | 'gamepad.lookSpeedY'
    | 'atmosphere.fogDensity'
    | 'atmosphere.ambientIntensity'
    | 'atmosphere.hemiIntensity'
    | 'atmosphere.sunGlow'
    | 'atmosphere.sunTemperature'
    | 'atmosphere.sunAzimuthDegrees'
    | 'atmosphere.sunDiscScale'
    | 'atmosphere.sunTimeOfDayHours'
    | 'fresnel.strength'
    | 'fresnel.radius'
    | 'movement.walkSpeed'
    | 'movement.jumpForce'
    | 'particles.amount'
    | 'particles.size'
    | 'cameraFeel.lookSensitivity'
    | 'cameraFeel.headBobAmount'
    | 'cameraFeel.normalFov'
    | 'cameraFeel.fastFov'
    | 'audio.musicVolume'
    | 'audio.fxVolume'
    | 'water.reflectionStrength'
    | 'water.reflectionContrast'
    | 'water.reflectivity'
    | 'water.normalStrength'
    | 'water.waveScale'
    | 'water.waveHeight'
    | 'water.flowSpeed'
    | 'water.foamIntensity'
    | 'water.normalDistort'
    | 'water.opacity'
    | 'lensDirt.strength'
    | 'lensDirt.minLuminance'
    | 'lensDirt.maxLuminance'
    | 'lensDirt.sensitivity';
  label: string;
  min: number;
  max: number;
  step: number;
  format?: (value: number) => string;
};

const fmt = (value: number, digits = 2): string => value.toFixed(digits);

const sliderGroups: { title: string; fields: SliderConfig[] }[] = [
  {
    title: 'Audio',
    fields: [
      {
        key: 'audio.musicVolume',
        label: 'Music',
        min: 0,
        max: 1,
        step: 0.01,
        format: (value) => `${Math.round(value * 100)}%`,
      },
      {
        key: 'audio.fxVolume',
        label: 'FX (jump, pads, crystals)',
        min: 0,
        max: 1,
        step: 0.01,
        format: (value) => `${Math.round(value * 100)}%`,
      },
    ],
  },
  {
    title: 'Post FX',
    fields: [
      { key: 'exposure', label: 'Exposure', min: 0.6, max: 2.5, step: 0.01 },
      { key: 'contrast', label: 'Contrast', min: 0.6, max: 1.6, step: 0.01 },
      { key: 'saturation', label: 'Saturation', min: 0.4, max: 1.8, step: 0.01 },
      { key: 'vignette', label: 'Vignette', min: 0, max: 2, step: 0.01 },
      { key: 'bloom.strength', label: 'Bloom Strength', min: 0, max: 2.8, step: 0.01 },
      { key: 'bloom.radius', label: 'Bloom Radius', min: 0, max: 1, step: 0.01 },
      { key: 'bloom.threshold', label: 'Bloom Threshold', min: 0, max: 1.2, step: 0.01 },
      {
        key: 'motionBlur.intensity',
        label: 'Motion Blur',
        min: 0,
        max: 2.5,
        step: 0.05,
        format: (value) => value.toFixed(2),
      },
    ],
  },
  {
    title: 'Lens dirt',
    fields: [
      {
        key: 'lensDirt.strength',
        label: 'Strength',
        min: 0,
        max: 2,
        step: 0.02,
        format: (value) => value.toFixed(2),
      },
      {
        key: 'lensDirt.minLuminance',
        label: 'Ramp min (exposure factor)',
        min: 0,
        max: 1,
        step: 0.01,
        format: (value) => value.toFixed(2),
      },
      {
        key: 'lensDirt.maxLuminance',
        label: 'Ramp max',
        min: 0,
        max: 1,
        step: 0.01,
        format: (value) => value.toFixed(2),
      },
      {
        key: 'lensDirt.sensitivity',
        label: 'Pow (curve)',
        min: 0.05,
        max: 3,
        step: 0.02,
        format: (value) => value.toFixed(2),
      },
    ],
  },
  {
    title: 'Atmosphere',
    fields: [
      {
        key: 'atmosphere.fogDensity',
        label: 'Fog Density',
        min: 0.002,
        max: 0.04,
        step: 0.001,
        format: (value) => value.toFixed(3),
      },
      {
        key: 'atmosphere.ambientIntensity',
        label: 'Ambient Lift',
        min: 0,
        max: 1.8,
        step: 0.01,
      },
      {
        key: 'atmosphere.hemiIntensity',
        label: 'Sky Gradient',
        min: 0,
        max: 2,
        step: 0.01,
      },
      { key: 'atmosphere.sunGlow', label: 'Sun Glow', min: 0.2, max: 2.5, step: 0.01 },
      {
        key: 'atmosphere.sunTimeOfDayHours',
        label: 'Time of day (h) — 12 = noon zenith',
        min: 0,
        max: 24,
        step: 0.05,
        format: (value) => value.toFixed(2),
      },
      {
        key: 'atmosphere.sunTemperature',
        label: 'Warmth bias (0.5 = time only)',
        min: 0,
        max: 1,
        step: 0.01,
        format: (value) => value.toFixed(2),
      },
      {
        key: 'atmosphere.sunAzimuthDegrees',
        label: 'Sun direction (orbit °)',
        min: 0,
        max: 360,
        step: 1,
        format: (value) => `${Math.round(value)}°`,
      },
      {
        key: 'atmosphere.sunDiscScale',
        label: 'Sun disc scale',
        min: 0.2,
        max: 3.5,
        step: 0.02,
        format: (value) => value.toFixed(2),
      },
    ],
  },
  {
    title: 'Surface',
    fields: [
      { key: 'fresnel.strength', label: 'Fresnel Strength', min: 0, max: 0.6, step: 0.01 },
      { key: 'fresnel.radius', label: 'Fresnel Radius', min: 0.05, max: 1, step: 0.01 },
    ],
  },
  {
    title: 'Water',
    fields: [
      {
        key: 'water.reflectionStrength',
        label: 'Reflection strength',
        min: 0,
        max: 2.5,
        step: 0.02,
        format: (value) => value.toFixed(2),
      },
      {
        key: 'water.reflectionContrast',
        label: 'Reflection contrast',
        min: 0.2,
        max: 3,
        step: 0.02,
        format: (value) => value.toFixed(2),
      },
      {
        key: 'water.reflectivity',
        label: 'Fresnel base (min reflect)',
        min: 0,
        max: 0.55,
        step: 0.01,
        format: (value) => value.toFixed(2),
      },
      {
        key: 'water.normalStrength',
        label: 'Ripple / normal strength',
        min: 0.1,
        max: 1.5,
        step: 0.01,
        format: (value) => value.toFixed(2),
      },
      {
        key: 'water.waveScale',
        label: 'Wave scale (UV tiling)',
        min: 2,
        max: 48,
        step: 0.5,
        format: (value) => value.toFixed(1),
      },
      {
        key: 'water.waveHeight',
        label: 'Wave height (mesh swell)',
        min: 0,
        max: 2.5,
        step: 0.05,
        format: (value) => value.toFixed(2),
      },
      {
        key: 'water.flowSpeed',
        label: 'Flow speed',
        min: 0,
        max: 0.2,
        step: 0.002,
        format: (value) => value.toFixed(3),
      },
      {
        key: 'water.foamIntensity',
        label: 'Shore foam',
        min: 0,
        max: 1.2,
        step: 0.01,
        format: (value) => value.toFixed(2),
      },
      {
        key: 'water.normalDistort',
        label: 'Reflection distortion',
        min: 0,
        max: 0.08,
        step: 0.001,
        format: (value) => value.toFixed(3),
      },
      {
        key: 'water.opacity',
        label: 'Opacity (0–1 translucent, 1–2 denser)',
        min: 0,
        max: 2,
        step: 0.02,
        format: (value) => value.toFixed(2),
      },
    ],
  },
  {
    title: 'Particles',
    fields: [
      { key: 'particles.amount', label: 'Particle Amount', min: 0, max: 160, step: 1 },
      {
        key: 'particles.size',
        label: 'Particle Size',
        min: 0.04,
        max: 12,
        step: 0.02,
        format: (value) => value.toFixed(2),
      },
    ],
  },
  {
    title: 'Gamepad',
    fields: [
      {
        key: 'gamepad.moveSpeedX',
        label: 'Move — horizontal (strafe)',
        min: 0.35,
        max: 2.5,
        step: 0.05,
        format: (value) => value.toFixed(2),
      },
      {
        key: 'gamepad.moveSpeedY',
        label: 'Move — vertical (forward/back)',
        min: 0.35,
        max: 2.5,
        step: 0.05,
        format: (value) => value.toFixed(2),
      },
      {
        key: 'gamepad.lookSpeedX',
        label: 'Look — horizontal (rad/s)',
        min: 0.5,
        max: 9,
        step: 0.05,
        format: (value) => value.toFixed(2),
      },
      {
        key: 'gamepad.lookSpeedY',
        label: 'Look — vertical (rad/s)',
        min: 0.5,
        max: 9,
        step: 0.05,
        format: (value) => value.toFixed(2),
      },
    ],
  },
  {
    title: 'Feel',
    fields: [
      { key: 'movement.walkSpeed', label: 'Walk Speed', min: 2, max: 10, step: 0.1 },
      { key: 'movement.jumpForce', label: 'Jump Force', min: 2, max: 8, step: 0.1 },
      {
        key: 'cameraFeel.lookSensitivity',
        label: 'Look Sensitivity',
        min: 0.001,
        max: 0.006,
        step: 0.0001,
        format: (value) => value.toFixed(4),
      },
      {
        key: 'cameraFeel.headBobAmount',
        label: 'Head Bob',
        min: 0,
        max: 0.12,
        step: 0.001,
        format: (value) => value.toFixed(3),
      },
      {
        key: 'cameraFeel.normalFov',
        label: 'Normal FOV',
        min: 60,
        max: 95,
        step: 1,
        format: (value) => value.toFixed(0),
      },
      {
        key: 'cameraFeel.fastFov',
        label: 'Fast FOV',
        min: 65,
        max: 130,
        step: 1,
        format: (value) => value.toFixed(0),
      },
    ],
  },
];

export class FxEditor {
  private readonly panel: HTMLDivElement;
  private readonly inputs = new Map<string, HTMLInputElement>();
  private readonly values = new Map<string, HTMLSpanElement>();
  private readonly motionBlurEnabledInput: HTMLInputElement;
  private readonly lensDirtEnabledInput: HTMLInputElement;
  private readonly fresnelColorInput: HTMLInputElement;
  private readonly fogColorInput: HTMLInputElement;
  private readonly particleColorInput: HTMLInputElement;
  private readonly waterColorInput: HTMLInputElement;
  private readonly settings: FxSettings;
  private readonly onChange: (settings: FxSettings) => void;
  private readonly onReset: () => void;
  private readonly copySettingsButton: HTMLButtonElement;
  private copyFeedbackTimer = 0;
  private open = false;

  constructor(
    mount: HTMLElement,
    settings: FxSettings,
    onChange: (settings: FxSettings) => void,
    onReset: () => void,
  ) {
    this.settings = settings;
    this.onChange = onChange;
    this.onReset = onReset;
    this.panel = document.createElement('div');
    this.panel.className = 'editor-panel';
    this.panel.hidden = true;
    this.panel.innerHTML = `
      <h2>FX Studio</h2>
      <p>Hidden editor for tuning bloom, atmosphere, and first-person feel while you walk the world.</p>
      <div class="editor-grid"></div>
      <div class="editor-footer">
        <span class="editor-footer-hint">Changes save automatically in this browser.</span>
        <div class="editor-footer-actions">
          <button class="start-button editor-copy-settings" type="button">Copy settings</button>
          <button class="start-button" type="button" data-editor-reset>Reset Look</button>
        </div>
      </div>
    `;

    const grid = this.panel.querySelector<HTMLDivElement>('.editor-grid')!;
    this.copySettingsButton = this.panel.querySelector<HTMLButtonElement>('.editor-copy-settings')!;
    const resetButton = this.panel.querySelector<HTMLButtonElement>('button[data-editor-reset]')!;

    const perfSection = document.createElement('section');
    perfSection.className = 'editor-group';
    const perfTitle = document.createElement('div');
    perfTitle.className = 'editor-group-title';
    perfTitle.textContent = 'Performance';
    const motionToggle = document.createElement('label');
    motionToggle.className = 'editor-field';
    const motionLabel = document.createElement('span');
    motionLabel.className = 'editor-label';
    motionLabel.textContent = 'Motion blur (extra GPU pass)';
    this.motionBlurEnabledInput = document.createElement('input');
    this.motionBlurEnabledInput.type = 'checkbox';
    this.motionBlurEnabledInput.checked = this.settings.motionBlur.enabled;
    this.motionBlurEnabledInput.addEventListener('change', () => {
      this.settings.motionBlur.enabled = this.motionBlurEnabledInput.checked;
      this.onChange(this.settings);
    });
    motionToggle.append(motionLabel, this.motionBlurEnabledInput);

    const lensDirtToggle = document.createElement('label');
    lensDirtToggle.className = 'editor-field';
    const lensDirtLabel = document.createElement('span');
    lensDirtLabel.className = 'editor-label';
    lensDirtLabel.textContent = 'Lens dirt (screen dust, Orby-style)';
    this.lensDirtEnabledInput = document.createElement('input');
    this.lensDirtEnabledInput.type = 'checkbox';
    this.lensDirtEnabledInput.checked = this.settings.lensDirt.enabled;
    this.lensDirtEnabledInput.addEventListener('change', () => {
      this.settings.lensDirt.enabled = this.lensDirtEnabledInput.checked;
      this.onChange(this.settings);
    });
    lensDirtToggle.append(lensDirtLabel, this.lensDirtEnabledInput);

    perfSection.append(perfTitle, motionToggle, lensDirtToggle);
    grid.append(perfSection);

    sliderGroups.forEach((group) => {
      const section = document.createElement('section');
      section.className = 'editor-group';

      const title = document.createElement('div');
      title.className = 'editor-group-title';
      title.textContent = group.title;
      section.append(title);

      group.fields.forEach((field) => {
        const wrapper = document.createElement('label');
        wrapper.className = 'editor-field';

        const label = document.createElement('span');
        label.className = 'editor-label';

        const name = document.createElement('span');
        name.textContent = field.label;

        const value = document.createElement('span');
        value.className = 'editor-value';
        this.values.set(field.key, value);

        label.append(name, value);

        const input = document.createElement('input');
        input.className = 'editor-input';
        input.type = 'range';
        input.min = String(field.min);
        input.max = String(field.max);
        input.step = String(field.step);
        input.value = String(this.getValue(field.key));
        input.addEventListener('input', () => {
          this.setValue(field.key, Number(input.value));
          value.textContent = (field.format ?? fmt)(Number(input.value));
          this.onChange(this.settings);
        });

        value.textContent = (field.format ?? fmt)(Number(input.value));

        this.inputs.set(field.key, input);
        wrapper.append(label, input);
        section.append(wrapper);
      });

      grid.append(section);
    });

    const fogSection = document.createElement('section');
    fogSection.className = 'editor-group';

    const fogTitle = document.createElement('div');
    fogTitle.className = 'editor-group-title';
    fogTitle.textContent = 'Fog Color';

    const fogField = document.createElement('label');
    fogField.className = 'editor-field';

    const fogLabel = document.createElement('span');
    fogLabel.className = 'editor-label';
    fogLabel.textContent = 'Distance haze';

    this.fogColorInput = document.createElement('input');
    this.fogColorInput.className = 'editor-input';
    this.fogColorInput.type = 'color';
    this.fogColorInput.value = this.settings.atmosphere.fogColor;
    this.fogColorInput.addEventListener('input', () => {
      this.settings.atmosphere.fogColor = this.fogColorInput.value;
      this.onChange(this.settings);
    });

    fogField.append(fogLabel, this.fogColorInput);
    fogSection.append(fogTitle, fogField);
    grid.append(fogSection);

    const fresnelSection = document.createElement('section');
    fresnelSection.className = 'editor-group';

    const fresnelTitle = document.createElement('div');
    fresnelTitle.className = 'editor-group-title';
    fresnelTitle.textContent = 'Fresnel Color';

    const fresnelField = document.createElement('label');
    fresnelField.className = 'editor-field';

    const fresnelLabel = document.createElement('span');
    fresnelLabel.className = 'editor-label';
    fresnelLabel.textContent = 'Edge Tint';

    this.fresnelColorInput = document.createElement('input');
    this.fresnelColorInput.className = 'editor-input';
    this.fresnelColorInput.type = 'color';
    this.fresnelColorInput.value = this.settings.fresnel.color;
    this.fresnelColorInput.addEventListener('input', () => {
      this.settings.fresnel.color = this.fresnelColorInput.value;
      this.onChange(this.settings);
    });

    fresnelField.append(fresnelLabel, this.fresnelColorInput);
    fresnelSection.append(fresnelTitle, fresnelField);
    grid.append(fresnelSection);

    const particleSection = document.createElement('section');
    particleSection.className = 'editor-group';

    const particleTitle = document.createElement('div');
    particleTitle.className = 'editor-group-title';
    particleTitle.textContent = 'Particle Color';

    const particleField = document.createElement('label');
    particleField.className = 'editor-field';

    const particleLabel = document.createElement('span');
    particleLabel.className = 'editor-label';
    particleLabel.textContent = 'Dust Tint';

    this.particleColorInput = document.createElement('input');
    this.particleColorInput.className = 'editor-input';
    this.particleColorInput.type = 'color';
    this.particleColorInput.value = this.settings.particles.color;
    this.particleColorInput.addEventListener('input', () => {
      this.settings.particles.color = this.particleColorInput.value;
      this.onChange(this.settings);
    });

    particleField.append(particleLabel, this.particleColorInput);
    particleSection.append(particleTitle, particleField);
    grid.append(particleSection);

    const waterColorSection = document.createElement('section');
    waterColorSection.className = 'editor-group';

    const waterColorTitle = document.createElement('div');
    waterColorTitle.className = 'editor-group-title';
    waterColorTitle.textContent = 'Water Color';

    const waterColorField = document.createElement('label');
    waterColorField.className = 'editor-field';

    const waterColorLabel = document.createElement('span');
    waterColorLabel.className = 'editor-label';
    waterColorLabel.textContent = 'Surface tint';

    this.waterColorInput = document.createElement('input');
    this.waterColorInput.className = 'editor-input';
    this.waterColorInput.type = 'color';
    this.waterColorInput.value = this.settings.water.color;
    this.waterColorInput.addEventListener('input', () => {
      this.settings.water.color = this.waterColorInput.value;
      this.onChange(this.settings);
    });

    waterColorField.append(waterColorLabel, this.waterColorInput);
    waterColorSection.append(waterColorTitle, waterColorField);
    grid.append(waterColorSection);

    this.copySettingsButton.addEventListener('click', () => {
      this.copySettingsToClipboard();
    });
    resetButton.addEventListener('click', () => this.onReset());
    mount.append(this.panel);
  }

  /**
   * Copies full FX settings as JSON (for sharing / asking to update `DEFAULT_FX_SETTINGS`).
   */
  private copySettingsToClipboard(): void {
    const payload = {
      candyLandsFxExport: {
        version: 1,
        storageKey: FX_SETTINGS_STORAGE_KEY,
        exportedAt: new Date().toISOString(),
        hint: 'Paste into chat to update defaults or reproduce this look in code.',
      },
      settings: structuredClone(this.settings),
    };
    const text = JSON.stringify(payload, null, 2);

    const flashCopied = (): void => {
      const btn = this.copySettingsButton;
      const prev = btn.textContent ?? 'Copy settings';
      btn.textContent = 'Copied!';
      window.clearTimeout(this.copyFeedbackTimer);
      this.copyFeedbackTimer = window.setTimeout(() => {
        btn.textContent = prev;
      }, 2000);
    };

    const tryFallback = (): boolean => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.append(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch {
        return false;
      }
    };

    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text).then(flashCopied).catch(() => {
        if (tryFallback()) {
          flashCopied();
        }
      });
    } else if (tryFallback()) {
      flashCopied();
    }
  }

  toggle(): void {
    this.open = !this.open;
    this.panel.hidden = !this.open;
  }

  get isOpen(): boolean {
    return this.open;
  }

  sync(): void {
    this.motionBlurEnabledInput.checked = this.settings.motionBlur.enabled;
    this.lensDirtEnabledInput.checked = this.settings.lensDirt.enabled;

    sliderGroups.flatMap((group) => group.fields).forEach((field) => {
      const value = this.getValue(field.key);
      const input = this.inputs.get(field.key);
      const label = this.values.get(field.key);

      if (input) {
        input.value = String(value);
      }

      if (label) {
        label.textContent = (field.format ?? fmt)(value);
      }
    });

    this.fogColorInput.value = this.settings.atmosphere.fogColor;
    this.fresnelColorInput.value = this.settings.fresnel.color;
    this.particleColorInput.value = this.settings.particles.color;
    this.waterColorInput.value = this.settings.water.color;
  }

  private getValue(key: SliderConfig['key']): number {
    const path = key.split('.');
    let value: unknown = this.settings;

    for (const part of path) {
      value = (value as unknown as Record<string, unknown>)[part];
    }

    return Number(value);
  }

  private setValue(key: SliderConfig['key'], nextValue: number): void {
    const path = key.split('.');
    let target = this.settings as unknown as Record<string, unknown>;

    for (let index = 0; index < path.length - 1; index += 1) {
      target = target[path[index]] as Record<string, unknown>;
    }

    target[path[path.length - 1]] = nextValue;
  }
}
