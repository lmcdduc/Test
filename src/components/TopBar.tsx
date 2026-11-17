import { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Menu,
  Search,
  Shield,
  ShieldAlert,
  Terminal as TerminalIcon,
} from 'lucide-react';
import type { ModelOption, ThinkingLevelOption } from '../shared/types';

interface TopBarProps {
  sessionTitle: string;
  models: ModelOption[];
  activeModelId: string;
  thinkingLevel: ThinkingLevelOption;
  autoApprove: boolean;
  terminalOpen: boolean;
  onOpenMobileSidebar: () => void;
  onSelectModel: (modelId: string, thinkingLevel?: ThinkingLevelOption) => void;
  onToggleAutoApprove: () => void;
  onToggleTerminal: () => void;
}

export function TopBar({
  sessionTitle,
  models,
  activeModelId,
  thinkingLevel,
  autoApprove,
  terminalOpen,
  onOpenMobileSidebar,
  onSelectModel,
  onToggleAutoApprove,
  onToggleTerminal,
}: TopBarProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const pickerRef = useRef<HTMLDivElement>(null);

  const activeModel = models.find((m) => m.id === activeModelId) ?? models[0];
  const supportedThinkingLevels = activeModel?.supportsThinkingLevels;

  const filteredModels = models.filter((m) => {
    const q = modelSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      m.id.toLowerCase().includes(q) ||
      m.label.toLowerCase().includes(q) ||
      m.description.toLowerCase().includes(q) ||
      m.tier.toLowerCase().includes(q)
    );
  });

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-slate-800/90 bg-[#111827] px-3 sm:gap-4 sm:px-4 lg:gap-8 lg:px-6">
      {/* Zone 1: Mobile Menu + Breadcrumb */}
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={onOpenMobileSidebar}
          aria-label="Ouvrir le menu latéral"
          className="rounded-md p-1.5 text-slate-300 hover:bg-slate-800 hover:text-white lg:hidden shrink-0"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <span className="font-display text-sm font-semibold text-white sm:hidden whitespace-nowrap">
            Kiln
          </span>
          <span className="hidden font-medium text-slate-400 sm:inline whitespace-nowrap">
            Workspace
          </span>
          <span className="hidden text-slate-600 sm:inline" aria-hidden="true">
            /
          </span>
          <h1 className="hidden truncate font-display text-sm font-semibold text-white sm:block">
            {sessionTitle}
          </h1>
        </div>
      </div>

      {/* Zone 2: Searchable Model Selector + Thinking Level */}
      <div className="relative" ref={pickerRef}>
        <button
          type="button"
          onClick={() => setDropdownOpen((o) => !o)}
          aria-expanded={dropdownOpen}
          aria-haspopup="listbox"
          aria-label="Sélecteur de modèles"
          className="flex items-center gap-2 rounded-lg border border-slate-700/80 bg-[#0B0F17] px-3 py-1.5 text-[13px] font-medium text-slate-100 transition-colors hover:border-slate-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 whitespace-nowrap shrink-0"
        >
          <span className="max-w-[130px] truncate sm:max-w-[220px]">
            {activeModel ? activeModel.label : activeModelId}
          </span>
          <ChevronDown
            className={`h-3.5 w-3.5 text-slate-400 transition-transform ${
              dropdownOpen ? 'rotate-180' : ''
            }`}
            aria-hidden="true"
          />
        </button>

        {dropdownOpen && (
          <div
            role="dialog"
            aria-label="Choisir un modèle Gemini"
            className="absolute right-0 z-40 mt-2 w-[310px] overflow-hidden rounded-xl border border-slate-700/90 bg-[#111827] shadow-xl sm:left-0 sm:right-auto sm:w-[350px]"
          >
            <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-2">
              <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
              <input
                type="text"
                value={modelSearch}
                onChange={(e) => setModelSearch(e.target.value)}
                placeholder="Filtrer les modèles (ex: flash, lite, pro)..."
                aria-label="Filtrer les modèles"
                autoFocus
                className="w-full bg-transparent text-[13px] text-slate-100 placeholder-slate-500 outline-none"
              />
            </div>

            <ul role="listbox" className="max-h-60 overflow-y-auto p-1.5">
              {filteredModels.length === 0 ? (
                <li className="px-3 py-4 text-center text-xs text-slate-400">
                  Aucun modèle ne correspond à « {modelSearch} ».
                </li>
              ) : (
                filteredModels.map((model) => {
                  const selected = model.id === activeModelId;
                  return (
                    <li key={model.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onClick={() => {
                          onSelectModel(model.id);
                          setDropdownOpen(false);
                          setModelSearch('');
                        }}
                        className={`flex w-full items-start justify-between gap-2 rounded-lg px-3 py-2 text-left transition-colors ${
                          selected
                            ? 'bg-blue-600/15 text-white'
                            : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                        }`}
                      >
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <span className="block truncate text-[13px] font-medium text-white">
                            {model.label}
                          </span>
                          <p className="text-[11px] text-slate-400">
                            {model.id} · {model.tier}
                          </p>
                          <p className="text-[11px] leading-snug text-slate-500">
                            {model.description}
                          </p>
                        </div>
                        {selected && (
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" aria-hidden="true" />
                        )}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>

            {supportedThinkingLevels && supportedThinkingLevels.length > 0 && (
              <div className="border-t border-slate-800 bg-[#0B0F17] px-3 py-2.5">
                <p className="mb-1.5 text-[11px] font-medium text-slate-400">
                  Profondeur de raisonnement ({activeModel.id})
                </p>
                <div className="flex items-center gap-1 rounded-lg bg-[#111827] p-1">
                  {supportedThinkingLevels.map((lvl) => {
                    const active = thinkingLevel === lvl;
                    return (
                      <button
                        key={lvl}
                        type="button"
                        onClick={() => onSelectModel(activeModel.id, lvl)}
                        className={`flex-1 rounded-md px-2 py-1 font-mono text-[11px] font-medium transition-colors whitespace-nowrap ${
                          active
                            ? 'bg-blue-600 text-white'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {lvl}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Zone 3: Permissions Mode + Terminal Toggle */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onToggleAutoApprove}
          aria-pressed={autoApprove}
          className={`hidden items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors sm:inline-flex whitespace-nowrap shrink-0 ${
            autoApprove
              ? 'border-amber-600/50 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20'
              : 'border-slate-700/80 bg-[#0B0F17] text-slate-300 hover:border-slate-600 hover:text-white'
          }`}
        >
          {autoApprove ? (
            <ShieldAlert className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
          ) : (
            <Shield className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
          )}
          <span>{autoApprove ? 'Auto-Approuver' : 'Permissions'}</span>
        </button>

        <button
          type="button"
          onClick={onToggleTerminal}
          aria-pressed={terminalOpen}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors whitespace-nowrap shrink-0 ${
            terminalOpen
              ? 'border-blue-500/60 bg-blue-600/15 text-blue-200'
              : 'border-slate-700/80 bg-[#0B0F17] text-slate-200 hover:border-slate-600 hover:text-white'
          }`}
        >
          <TerminalIcon className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Terminal</span>
        </button>
      </div>
    </header>
  );
}
