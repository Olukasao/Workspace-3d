/**
 * "Ausente": a pessoa marca (botão) ou o navegador marca depois de 5 minutos sem mouse, teclado ou toque; voltar a usar tira
 * a marca automática (a marca manual só sai pelo botão). O estado vai ao servidor, que o repassa a todos (status real).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { awaySignal } from '../../../live';

export const AUTO_AWAY_MS = 5 * 60_000;

export function useAway() {
  const [manual, setManual] = useState(false);
  const [auto, setAuto] = useState(false);
  const last = useRef(Date.now());
  const manualRef = useRef(false);
  const autoRef = useRef(false);

  useEffect(() => {
    const touch = () => {
      last.current = Date.now();
      if (autoRef.current) {
        autoRef.current = false;
        setAuto(false);
        if (!manualRef.current) awaySignal.set(false);
      }
    };
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;
    for (const e of events) window.addEventListener(e, touch, { passive: true });
    const timer = setInterval(() => {
      if (!autoRef.current && !manualRef.current && Date.now() - last.current > AUTO_AWAY_MS) {
        autoRef.current = true;
        setAuto(true);
        awaySignal.set(true);
      }
    }, 10_000);
    return () => {
      for (const e of events) window.removeEventListener(e, touch);
      clearInterval(timer);
      awaySignal.set(false); // sair do 2D (ou trocar de ambiente) tira a marca
    };
  }, []);

  const toggle = useCallback(() => {
    const next = !manualRef.current;
    manualRef.current = next;
    setManual(next);
    awaySignal.set(next || autoRef.current);
  }, []);

  return { away: manual || auto, manual, toggle };
}
