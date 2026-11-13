/** Controles do editor do estilo Ara 3D Gen: slider com valor, cor com amostras e grade de opções com miniatura. */
import { RotateCcw } from 'lucide-react';
import { ARA_DATA_URL } from './preview';

export function Slider({ label, value, min = 0, max = 1, step = 0.01, onChange, format, resetTo, id }: { label: string; value: number; min?: number; max?: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string; resetTo?: number; id?: string }) {
  const text = format ? format(value) : value.toFixed(2).replace('.', ',');
  return (
    <label className="slider-row" data-slider={id}>
      <span className="slider-label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label} aria-valuetext={text} onChange={(e) => onChange(Number(e.target.value))} />
      <output>{text}</output>
      {resetTo !== undefined && (
        <button type="button" className="btn icon ghost small" title="Voltar ao valor padrão" aria-label={`Zerar ${label}`} disabled={value === resetTo} onClick={() => onChange(resetTo)}>
          <RotateCcw size={12} />
        </button>
      )}
    </label>
  );
}

export function ColorField({ label, value, onChange, swatches, id }: { label: string; value: string; onChange: (c: string) => void; swatches?: Array<{ hex: string; name: string }>; id?: string }) {
  return (
    <div className="color-field" role="group" aria-label={label} data-color-field={id}>
      <span className="slider-label">{label}</span>
      <div className="swatches">
        {swatches?.map((s) => (
          <button key={s.hex} type="button" className="swatch" style={{ background: s.hex }} title={s.name} aria-label={s.name} aria-pressed={value.toLowerCase() === s.hex.toLowerCase()} onClick={() => onChange(s.hex)} />
        ))}
        <input type="color" value={value} aria-label={`${label}: escolher outra cor`} onChange={(e) => onChange(e.target.value)} />
      </div>
    </div>
  );
}

export interface Option {
  id: string;
  label: string;
  thumb?: string;
}

/** Grade de opções (cabelo, olhos, roupa...); com `thumb`, mostra a miniatura do catálogo do Ara. */
export function OptionGrid({ options, value, onPick, label, name }: { options: Option[]; value: string; onPick: (id: string) => void; label: string; name: string }) {
  return (
    <div className="opt-grid" role="radiogroup" aria-label={label} data-options={name}>
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} aria-pressed={value === o.id} className={`opt-card${o.thumb ? '' : ' text'}`} data-option={o.id} title={o.label} onClick={() => onPick(o.id)}>
          {o.thumb && <img src={ARA_DATA_URL + o.thumb} alt="" width={44} height={44} loading="lazy" />}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export const NATURAL_HAIR = [
  { hex: '#120d0a', name: 'Preto' }, { hex: '#2a1e16', name: 'Castanho-escuro' }, { hex: '#4a3a30', name: 'Castanho' }, { hex: '#8a5a32', name: 'Castanho-claro' },
  { hex: '#b0652a', name: 'Ruivo' }, { hex: '#c8a15a', name: 'Loiro' }, { hex: '#b9b9b9', name: 'Grisalho' }, { hex: '#e8e8e8', name: 'Branco' },
];
export const FABRIC_COLORS = [
  { hex: '#26324a', name: 'Marinho' }, { hex: '#2b2d33', name: 'Grafite' }, { hex: '#6b7280', name: 'Cinza' }, { hex: '#c9b597', name: 'Bege' }, { hex: '#f1ece4', name: 'Off-white' },
  { hex: '#ffffff', name: 'Branco' }, { hex: '#3a5a8a', name: 'Azul' }, { hex: '#3a8f94', name: 'Verde-água' }, { hex: '#5a1f2b', name: 'Vinho' }, { hex: '#e3c168', name: 'Mostarda' }, { hex: '#a9c4e0', name: 'Azul-claro' }, { hex: '#1c1c1f', name: 'Preto' },
];
