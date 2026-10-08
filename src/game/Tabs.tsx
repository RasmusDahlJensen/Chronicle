import { useRef, type KeyboardEvent, type ReactNode } from 'react';

/**
 * Tabs in the ARIA pattern (U.2, U.3): a tab list whose arrow keys, Home and End choose a tab and move focus to it
 * (roving tab index), and one tab panel showing the chosen tab. Keys pressed with a modifier are left to the browser.
 */
export function Tabs<T extends string>({ id, label, tabs, names, chosen, onChoose, busy = false, className = '', panelClassName = '', children }: {
  id: string; label: string; tabs: readonly T[]; names: Record<T, string>; chosen: T; onChoose: (tab: T) => void; busy?: boolean; className?: string; panelClassName?: string; children: ReactNode;
}) {
  const buttons = useRef(new Map<T, HTMLButtonElement>());
  function key(event: KeyboardEvent) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const at = tabs.indexOf(chosen), step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[tabs.length - 1] : step ? tabs[(at + step + tabs.length) % tabs.length] : null;
    if (!next) return;
    event.preventDefault(); onChoose(next); buttons.current.get(next)?.focus();
  }
  return <>
    <div className={`game-tabs ${className}`.trim()} role="tablist" aria-label={label} onKeyDown={key}>
      {tabs.map(tab => <button key={tab} ref={element => { if (element) buttons.current.set(tab, element); else buttons.current.delete(tab); }}
        type="button" role="tab" id={`${id}-tab-${tab}`} aria-selected={tab === chosen} aria-controls={`${id}-panel`} tabIndex={tab === chosen ? 0 : -1}
        onClick={() => onChoose(tab)}>{names[tab]}</button>)}
    </div>
    <div className={`game-tabs-panel ${panelClassName}`.trim()} role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${chosen}`} data-tab={chosen} tabIndex={0} aria-busy={busy}>
      {children}
    </div>
  </>;
}
