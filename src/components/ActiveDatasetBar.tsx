// import { Database, RefreshCw, ChevronDown, Layers, FolderOpen } from 'lucide-react';
// import { useEffect, useMemo, useRef, useState } from 'react';
// import type { AuditArea, AuditVertical, FileMetadata, SavedDataset } from '../lib/types';
// import { formatNumber } from '../lib/helpers';

// interface Props {
//   file: FileMetadata | null;
//   savedDatasets: SavedDataset[];
//   loadDataset: (id: string) => void;
//   loadingDataset: string | null;
//   goToUpload: () => void;
//   auditAreas: AuditArea[];
//   setAuditArea: (datasetId: string, code: string | null) => void;
//   engagementVertical: AuditVertical | null;
// }

// const VERTICAL_LABELS: Record<AuditVertical, string> = {
//   general: 'General — AS / Ind AS',
//   bank: 'Bank',
//   nbfc: 'NBFC',
//   insurance: 'Insurance',
// };

// const CATEGORY_LABELS: Record<string, string> = {
//   line_item: 'Line Items',
//   methodology: 'Methodology',
//   compliance: 'Compliance',
//   reporting: 'Reporting',
//   planning: 'Planning',
//   source_data: 'Source Data',
//   other: 'Other',
// };

// // Audit-area cross-vertical applicability:
// //   • general engagements see only general areas
// //   • bank/nbfc/insurance see their own vertical PLUS general
// //   • engagement vertical not set yet → show all
// function visibleVerticals(engagementVertical: AuditVertical | null): Set<AuditVertical> {
//   if (!engagementVertical) return new Set(['general', 'bank', 'nbfc', 'insurance']);
//   if (engagementVertical === 'general') return new Set(['general']);
//   return new Set(['general', engagementVertical]);
// }

// export const ActiveDatasetBar = ({ file, savedDatasets, loadDataset, loadingDataset, goToUpload, auditAreas, setAuditArea, engagementVertical }: Props) => {
//   const [open, setOpen] = useState(false);
//   const [areaOpen, setAreaOpen] = useState(false);
//   const ref = useRef<HTMLDivElement>(null);
//   const areaRef = useRef<HTMLDivElement>(null);

//   useEffect(() => {
//     const onClick = (e: MouseEvent) => {
//       if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
//       if (areaRef.current && !areaRef.current.contains(e.target as Node)) setAreaOpen(false);
//     };
//     document.addEventListener('mousedown', onClick);
//     return () => document.removeEventListener('mousedown', onClick);
//   }, []);

//   const currentArea = file?.audit_area_code
//     ? auditAreas.find(a => a.id === file.audit_area_code)
//     : null;

//   // Group areas by (vertical, category) restricted to applicable verticals.
//   const groupedAreas = useMemo(() => {
//     const allowed = visibleVerticals(engagementVertical);
//     const verticalsOrder: AuditVertical[] = ['general', 'bank', 'nbfc', 'insurance'];
//     const out: Array<{ vertical: AuditVertical; categories: Array<{ category: string; areas: AuditArea[] }> }> = [];
//     for (const v of verticalsOrder) {
//       if (!allowed.has(v)) continue;
//       const inV = auditAreas.filter(a => a.vertical === v).sort((a, b) => a.display_order - b.display_order);
//       if (inV.length === 0) continue;
//       const byCat = new Map<string, AuditArea[]>();
//       inV.forEach(a => {
//         const list = byCat.get(a.category) || [];
//         list.push(a);
//         byCat.set(a.category, list);
//       });
//       const catOrder = ['line_item', 'methodology', 'compliance', 'reporting', 'planning', 'source_data', 'other'];
//       out.push({
//         vertical: v,
//         categories: catOrder
//           .filter(c => byCat.has(c))
//           .map(c => ({ category: c, areas: byCat.get(c)! })),
//       });
//     }
//     return out;
//   }, [auditAreas, engagementVertical]);

//   if (!file) {
//     return (
//       <div className="bg-warn/5 border-b border-warn/20 px-6 py-2">
//         <div className="max-w-6xl mx-auto flex items-center justify-between gap-4 text-[11px]">
//           <div className="flex items-center gap-2 text-warn font-mono">
//             <Database size={12} />
//             <span>No active dataset</span>
//           </div>
//           <button onClick={goToUpload} className="text-acc hover:underline font-medium">
//             Upload or load a dataset →
//           </button>
//         </div>
//       </div>
//     );
//   }

//   return (
//     <div className="bg-sub/30 border-b border-border px-6 py-2">
//       <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
//         <div className="flex items-center gap-3 min-w-0">
//           <div className="flex items-center gap-2 text-acc">
//             <Database size={13} />
//             <span className="font-mono text-[10px] uppercase tracking-wider">Active</span>
//           </div>
//           <span className="text-[12px] font-mono font-semibold text-tx truncate" title={file.name}>
//             {file.name}
//           </span>
//           <span className="text-[10px] font-mono text-tx3 hidden sm:inline">
//             {formatNumber(file.row_count_approx)} rows · {file.columns?.length || 0} cols
//           </span>
//           {file.dataset_type && file.dataset_type !== 'general' && (
//             <span className="hidden md:inline text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-info/10 text-info border border-info/20">
//               {file.dataset_type.replace(/_/g, ' ')}
//             </span>
//           )}

//           <div ref={areaRef} className="relative">
//             <button
//               onClick={() => setAreaOpen(o => !o)}
//               title={currentArea ? `Audit area: ${currentArea.code} — ${currentArea.title}` : 'Tag this dataset to an audit area'}
//               className={`flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full border transition-colors ${
//                 currentArea
//                   ? 'bg-acc/10 text-acc border-acc/30 hover:bg-acc/15'
//                   : 'bg-surf text-tx3 border-border hover:text-tx hover:border-tx3'
//               }`}
//             >
//               <FolderOpen size={10} />
//               {currentArea ? `${currentArea.code} · ${currentArea.title}` : 'Tag area'}
//               <ChevronDown size={9} className={`transition-transform ${areaOpen ? 'rotate-180' : ''}`} />
//             </button>
//             {areaOpen && (
//               <div className="absolute top-full left-0 mt-1 w-80 bg-surf border border-border rounded-xl shadow-lg z-50 overflow-hidden">
//                 <div className="px-3 py-2 border-b border-border bg-sub/30 flex items-center justify-between">
//                   <span className="font-mono text-[9px] uppercase tracking-wider text-tx3">Audit Area</span>
//                   {currentArea && file.dataset_id && (
//                     <button
//                       onClick={() => { setAuditArea(file.dataset_id!, null); setAreaOpen(false); }}
//                       className="text-[9px] font-mono uppercase tracking-wider text-tx3 hover:text-err"
//                     >
//                       Clear
//                     </button>
//                   )}
//                 </div>
//                 <div className="max-h-96 overflow-y-auto">
//                   {groupedAreas.length === 0 && (
//                     <div className="px-3 py-4 text-[11px] text-tx3 italic text-center">No areas configured</div>
//                   )}
//                   {groupedAreas.map(group => (
//                     <div key={group.vertical} className="border-b border-border last:border-0">
//                       <div className="px-3 py-1.5 bg-sub/20 text-[9px] font-mono uppercase tracking-wider text-tx3 sticky top-0">
//                         {VERTICAL_LABELS[group.vertical]}
//                       </div>
//                       {group.categories.map(c => (
//                         <div key={c.category}>
//                           <div className="px-3 pt-1.5 pb-0.5 text-[8px] font-mono uppercase tracking-wider text-tx3/70">
//                             {CATEGORY_LABELS[c.category] || c.category}
//                           </div>
//                           {c.areas.map(a => {
//                             const isActive = currentArea?.id === a.id;
//                             return (
//                               <button
//                                 key={a.id}
//                                 onClick={() => { if (file.dataset_id) setAuditArea(file.dataset_id, a.id); setAreaOpen(false); }}
//                                 className={`w-full text-left px-3 py-1 transition-colors flex items-center gap-2 ${
//                                   isActive ? 'bg-acc/5 text-acc' : 'hover:bg-sub/40 text-tx2'
//                                 }`}
//                               >
//                                 <span className="font-mono text-[10px] font-bold w-20 truncate">{a.code}</span>
//                                 <span className="text-[11px] truncate flex-1">{a.title}</span>
//                               </button>
//                             );
//                           })}
//                         </div>
//                       ))}
//                     </div>
//                   ))}
//                 </div>
//               </div>
//             )}
//           </div>
//         </div>

//         <div ref={ref} className="relative flex-shrink-0">
//           <button
//             onClick={() => setOpen(o => !o)}
//             className="flex items-center gap-1.5 text-[11px] font-mono text-tx3 hover:text-tx transition-colors px-2 py-1 rounded hover:bg-surf"
//           >
//             <Layers size={11} />
//             Switch
//             <ChevronDown size={10} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
//           </button>
//           {open && (
//             <div className="absolute top-full right-0 mt-1 w-72 bg-surf border border-border rounded-xl shadow-lg z-50 overflow-hidden">
//               <div className="px-3 py-2 border-b border-border bg-sub/30">
//                 <span className="font-mono text-[9px] uppercase tracking-wider text-tx3">Saved Datasets</span>
//               </div>
//               <div className="max-h-80 overflow-y-auto">
//                 {savedDatasets.length === 0 && (
//                   <div className="px-3 py-4 text-[11px] text-tx3 italic text-center">No saved datasets</div>
//                 )}
//                 {savedDatasets.map(ds => {
//                   const isActive = file.dataset_id === ds.id;
//                   return (
//                     <button
//                       key={ds.id}
//                       onClick={() => { if (!isActive) loadDataset(ds.id); setOpen(false); }}
//                       disabled={loadingDataset === ds.id}
//                       className={`w-full text-left px-3 py-2 transition-colors flex items-center justify-between gap-2 ${
//                         isActive ? 'bg-acc/5 text-acc' : 'hover:bg-sub/40 text-tx2'
//                       }`}
//                     >
//                       <div className="min-w-0 flex-1">
//                         <div className="text-[11px] font-mono font-semibold truncate flex items-center gap-1.5">
//                           {ds.audit_area_code && (
//                             <span className="text-[9px] font-mono font-bold px-1 py-0.5 rounded bg-acc/10 text-acc">
//                               {ds.audit_area_code.includes(':') ? ds.audit_area_code.split(':')[1] : ds.audit_area_code}
//                             </span>
//                           )}
//                           <span className="truncate">{ds.original_filename}</span>
//                         </div>
//                         <div className="text-[10px] text-tx3 mt-0.5">
//                           {(ds.row_count ?? 0).toLocaleString()} rows
//                           {ds.file_type && <> · {ds.file_type.toUpperCase()}</>}
//                         </div>
//                       </div>
//                       {isActive && <span className="text-[9px] font-mono text-acc">ACTIVE</span>}
//                       {loadingDataset === ds.id && <RefreshCw size={11} className="animate-spin text-tx3" />}
//                     </button>
//                   );
//                 })}
//               </div>
//               <div className="border-t border-border">
//                 <button onClick={() => { setOpen(false); goToUpload(); }} className="w-full px-3 py-2 text-[11px] text-acc hover:bg-acc/5 text-left">
//                   + Upload new file
//                 </button>
//               </div>
//             </div>
//           )}
//         </div>
//       </div>
//     </div>
//   );
// };


// import { Database, RefreshCw, ChevronDown, Layers, FolderOpen } from 'lucide-react';
// import { useEffect, useMemo, useRef, useState } from 'react';
// import type { AuditArea, AuditVertical, FileMetadata, SavedDataset } from '../lib/types';
// import { formatNumber } from '../lib/helpers';

// interface Props {
//   file: FileMetadata | null;
//   savedDatasets: SavedDataset[];
//   loadDataset: (id: string) => void;
//   loadingDataset: string | null;
//   goToUpload: () => void;
//   auditAreas: AuditArea[];
//   setAuditArea: (datasetId: string, code: string | null) => void;
//   engagementVertical: AuditVertical | null;
// }

// const VERTICAL_LABELS: Record<AuditVertical, string> = {
//   general: 'General — AS / Ind AS',
//   bank: 'Bank',
//   nbfc: 'NBFC',
//   insurance: 'Insurance',
// };

// const CATEGORY_LABELS: Record<string, string> = {
//   line_item: 'Line Items',
//   methodology: 'Methodology',
//   compliance: 'Compliance',
//   reporting: 'Reporting',
//   planning: 'Planning',
//   source_data: 'Source Data',
//   other: 'Other',
// };

// // Audit-area cross-vertical applicability:
// //   • general engagements see only general areas
// //   • bank/nbfc/insurance see their own vertical PLUS general
// //   • engagement vertical not set yet → show all
// function visibleVerticals(engagementVertical: AuditVertical | null): Set<AuditVertical> {
//   if (!engagementVertical) return new Set(['general', 'bank', 'nbfc', 'insurance']);
//   if (engagementVertical === 'general') return new Set(['general']);
//   return new Set(['general', engagementVertical]);
// }

// export const ActiveDatasetBar = ({ file, savedDatasets, loadDataset, loadingDataset, goToUpload, auditAreas, setAuditArea, engagementVertical }: Props) => {
//   const [open, setOpen] = useState(false);
//   const [areaOpen, setAreaOpen] = useState(false);
//   const ref = useRef<HTMLDivElement>(null);
//   const areaRef = useRef<HTMLDivElement>(null);

//   useEffect(() => {
//     const onClick = (e: MouseEvent) => {
//       if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
//       if (areaRef.current && !areaRef.current.contains(e.target as Node)) setAreaOpen(false);
//     };
//     document.addEventListener('mousedown', onClick);
//     return () => document.removeEventListener('mousedown', onClick);
//   }, []);

//   const currentArea = file?.audit_area_code
//     ? auditAreas.find(a => a.id === file.audit_area_code)
//     : null;

//   // Group areas by (vertical, category) restricted to applicable verticals.
//   const groupedAreas = useMemo(() => {
//     const allowed = visibleVerticals(engagementVertical);
//     const verticalsOrder: AuditVertical[] = ['general', 'bank', 'nbfc', 'insurance'];
//     const out: Array<{ vertical: AuditVertical; categories: Array<{ category: string; areas: AuditArea[] }> }> = [];
//     for (const v of verticalsOrder) {
//       if (!allowed.has(v)) continue;
//       const inV = auditAreas.filter(a => a.vertical === v).sort((a, b) => a.display_order - b.display_order);
//       if (inV.length === 0) continue;
//       const byCat = new Map<string, AuditArea[]>();
//       inV.forEach(a => {
//         const list = byCat.get(a.category) || [];
//         list.push(a);
//         byCat.set(a.category, list);
//       });
//       const catOrder = ['line_item', 'methodology', 'compliance', 'reporting', 'planning', 'source_data', 'other'];
//       out.push({
//         vertical: v,
//         categories: catOrder
//           .filter(c => byCat.has(c))
//           .map(c => ({ category: c, areas: byCat.get(c)! })),
//       });
//     }
//     return out;
//   }, [auditAreas, engagementVertical]);

//   if (!file) {
//     return (
//       <div className="bg-warn/5 border-b border-warn/20 px-6 py-2">
//         <div className="max-w-6xl mx-auto flex items-center justify-between gap-4 text-[11px]">
//           <div className="flex items-center gap-2 text-warn font-mono">
//             <Database size={12} />
//             <span>No active dataset</span>
//           </div>
//           <button onClick={goToUpload} className="text-acc hover:underline font-medium">
//             Upload or load a dataset →
//           </button>
//         </div>
//       </div>
//     );
//   }

//   return (
//     <div className="bg-sub/30 border-b border-border px-6 py-2">
//       <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
//         <div className="flex items-center gap-3 min-w-0">
//           <div className="flex items-center gap-2 text-acc">
//             <Database size={13} />
//             <span className="font-mono text-[10px] uppercase tracking-wider">Active</span>
//           </div>
//           <span className="text-[12px] font-mono font-semibold text-tx truncate" title={file.name}>
//             {file.name}
//           </span>
//           <span className="text-[10px] font-mono text-tx3 hidden sm:inline">
//             {formatNumber(file.row_count_approx)} rows · {file.columns?.length || 0} cols
//           </span>
//           {file.dataset_type && file.dataset_type !== 'general' && (
//             <span className="hidden md:inline text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-info/10 text-info border border-info/20">
//               {file.dataset_type.replace(/_/g, ' ')}
//             </span>
//           )}

//           <div ref={areaRef} className="relative">
//             <button
//               onClick={() => setAreaOpen(o => !o)}
//               title={currentArea ? `Audit area: ${currentArea.code} — ${currentArea.title}` : 'Tag this dataset to an audit area'}
//               className={`flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full border transition-colors ${
//                 currentArea
//                   ? 'bg-acc/10 text-acc border-acc/30 hover:bg-acc/15'
//                   : 'bg-surf text-tx3 border-border hover:text-tx hover:border-tx3'
//               }`}
//             >
//               <FolderOpen size={10} />
//               {currentArea ? `${currentArea.code} · ${currentArea.title}` : 'Tag area'}
//               <ChevronDown size={9} className={`transition-transform ${areaOpen ? 'rotate-180' : ''}`} />
//             </button>
//             {areaOpen && (
//               <div className="absolute top-full left-0 mt-1 w-80 bg-surf border border-border rounded-xl shadow-lg z-50 overflow-hidden">
//                 <div className="px-3 py-2 border-b border-border bg-sub/30 flex items-center justify-between">
//                   <span className="font-mono text-[9px] uppercase tracking-wider text-tx3">Audit Area</span>
//                   {currentArea && file.dataset_id && (
//                     <button
//                       onClick={() => { setAuditArea(file.dataset_id!, null); setAreaOpen(false); }}
//                       className="text-[9px] font-mono uppercase tracking-wider text-tx3 hover:text-err"
//                     >
//                       Clear
//                     </button>
//                   )}
//                 </div>
//                 <div className="max-h-96 overflow-y-auto">
//                   {groupedAreas.length === 0 && (
//                     <div className="px-3 py-4 text-[11px] text-tx3 italic text-center">No areas configured</div>
//                   )}
//                   {groupedAreas.map(group => (
//                     <div key={group.vertical} className="border-b border-border last:border-0">
//                       <div className="px-3 py-1.5 bg-sub/20 text-[9px] font-mono uppercase tracking-wider text-tx3 sticky top-0">
//                         {VERTICAL_LABELS[group.vertical]}
//                       </div>
//                       {group.categories.map(c => (
//                         <div key={c.category}>
//                           <div className="px-3 pt-1.5 pb-0.5 text-[8px] font-mono uppercase tracking-wider text-tx3/70">
//                             {CATEGORY_LABELS[c.category] || c.category}
//                           </div>
//                           {c.areas.map(a => {
//                             const isActive = currentArea?.id === a.id;
//                             return (
//                               <button
//                                 key={a.id}
//                                 onClick={() => { if (file.dataset_id) setAuditArea(file.dataset_id, a.id); setAreaOpen(false); }}
//                                 className={`w-full text-left px-3 py-1 transition-colors flex items-center gap-2 ${
//                                   isActive ? 'bg-acc/5 text-acc' : 'hover:bg-sub/40 text-tx2'
//                                 }`}
//                               >
//                                 <span className="font-mono text-[10px] font-bold w-20 truncate">{a.code}</span>
//                                 <span className="text-[11px] truncate flex-1">{a.title}</span>
//                               </button>
//                             );
//                           })}
//                         </div>
//                       ))}
//                     </div>
//                   ))}
//                 </div>
//               </div>
//             )}
//           </div>
//         </div>

//         <div ref={ref} className="relative flex-shrink-0">
//           <button
//             onClick={() => setOpen(o => !o)}
//             className="flex items-center gap-1.5 text-[11px] font-mono text-tx3 hover:text-tx transition-colors px-2 py-1 rounded hover:bg-surf"
//           >
//             <Layers size={11} />
//             Switch
//             <ChevronDown size={10} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
//           </button>
//           {open && (
//             <div className="absolute top-full right-0 mt-1 w-72 bg-surf border border-border rounded-xl shadow-lg z-50 overflow-hidden">
//               <div className="px-3 py-2 border-b border-border bg-sub/30">
//                 <span className="font-mono text-[9px] uppercase tracking-wider text-tx3">Saved Datasets</span>
//               </div>
//               <div className="max-h-80 overflow-y-auto">
//                 {savedDatasets.length === 0 && (
//                   <div className="px-3 py-4 text-[11px] text-tx3 italic text-center">No saved datasets</div>
//                 )}
//                 {savedDatasets.map(ds => {
//                   const isActive = file.dataset_id === ds.id;
//                   return (
//                     <button
//                       key={ds.id}
//                       onClick={() => { if (!isActive) loadDataset(ds.id); setOpen(false); }}
//                       disabled={loadingDataset === ds.id}
//                       className={`w-full text-left px-3 py-2 transition-colors flex items-center justify-between gap-2 ${
//                         isActive ? 'bg-acc/5 text-acc' : 'hover:bg-sub/40 text-tx2'
//                       }`}
//                     >
//                       <div className="min-w-0 flex-1">
//                         <div className="text-[11px] font-mono font-semibold truncate flex items-center gap-1.5">
//                           {ds.audit_area_code && (
//                             <span className="text-[9px] font-mono font-bold px-1 py-0.5 rounded bg-acc/10 text-acc">
//                               {ds.audit_area_code.includes(':') ? ds.audit_area_code.split(':')[1] : ds.audit_area_code}
//                             </span>
//                           )}
//                           <span className="truncate">{ds.original_filename}</span>
//                         </div>
//                         <div className="text-[10px] text-tx3 mt-0.5">
//                           {(ds.row_count ?? 0).toLocaleString()} rows
//                           {ds.file_type && <> · {ds.file_type.toUpperCase()}</>}
//                         </div>
//                       </div>
//                       {isActive && <span className="text-[9px] font-mono text-acc">ACTIVE</span>}
//                       {loadingDataset === ds.id && <RefreshCw size={11} className="animate-spin text-tx3" />}
//                     </button>
//                   );
//                 })}
//               </div>
//               <div className="border-t border-border">
//                 <button onClick={() => { setOpen(false); goToUpload(); }} className="w-full px-3 py-2 text-[11px] text-acc hover:bg-acc/5 text-left">
//                   + Upload new file
//                 </button>
//               </div>
//             </div>
//           )}
//         </div>
//       </div>
//     </div>
//   );
// };


import { Database, RefreshCw, ChevronDown, Layers, FolderOpen } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AuditArea, AuditVertical, FileMetadata, SavedDataset } from '../lib/types';
import { formatNumber } from '../lib/helpers';

interface Props {
  file: FileMetadata | null;
  savedDatasets: SavedDataset[];
  loadDataset: (id: string) => void;
  loadingDataset: string | null;
  goToUpload: () => void;
  auditAreas: AuditArea[];
  setAuditArea: (datasetId: string, code: string | null) => void;
  engagementVertical: AuditVertical | null;
  activeTab: string;
}

const VERTICAL_LABELS: Record<AuditVertical, string> = {
  general: 'General — AS / Ind AS',
  bank: 'Bank',
  nbfc: 'NBFC',
  insurance: 'Insurance',
};

const CATEGORY_LABELS: Record<string, string> = {
  line_item: 'Line Items',
  methodology: 'Methodology',
  compliance: 'Compliance',
  reporting: 'Reporting',
  planning: 'Planning',
  source_data: 'Source Data',
  other: 'Other',
};

function visibleVerticals(engagementVertical: AuditVertical | null): Set<AuditVertical> {
  if (!engagementVertical) return new Set(['general', 'bank', 'nbfc', 'insurance']);
  if (engagementVertical === 'general') return new Set(['general']);
  return new Set(['general', engagementVertical]);
}

export const ActiveDatasetBar = ({
  file, savedDatasets, loadDataset, loadingDataset, goToUpload,
  auditAreas, setAuditArea, engagementVertical,
  activeTab,
}: Props) => {
  const [open, setOpen] = useState(false);
  const [areaOpen, setAreaOpen] = useState(false);

  const ref = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
      if (areaRef.current && !areaRef.current.contains(e.target as Node)) setAreaOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const currentArea = file?.audit_area_code
    ? auditAreas.find(a => a.id === file.audit_area_code)
    : null;

  const groupedAreas = useMemo(() => {
    const allowed = visibleVerticals(engagementVertical);
    const verticalsOrder: AuditVertical[] = ['general', 'bank', 'nbfc', 'insurance'];
    const out: Array<{ vertical: AuditVertical; categories: Array<{ category: string; areas: AuditArea[] }> }> = [];
    for (const v of verticalsOrder) {
      if (!allowed.has(v)) continue;
      const inV = auditAreas.filter(a => a.vertical === v).sort((a, b) => a.display_order - b.display_order);
      if (inV.length === 0) continue;
      const byCat = new Map<string, AuditArea[]>();
      inV.forEach(a => {
        const list = byCat.get(a.category) || [];
        list.push(a);
        byCat.set(a.category, list);
      });
      const catOrder = ['line_item', 'methodology', 'compliance', 'reporting', 'planning', 'source_data', 'other'];
      out.push({
        vertical: v,
        categories: catOrder
          .filter(c => byCat.has(c))
          .map(c => ({ category: c, areas: byCat.get(c)! })),
      });
    }
    return out;
  }, [auditAreas, engagementVertical]);

  if (!file) {
    return (
      <div className="bg-warn/5 border-b border-warn/20 px-6 py-2">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4 text-[11px]">
          <div className="flex items-center gap-2 text-warn font-mono">
            <Database size={12} />
            <span>No active dataset</span>
          </div>
          <button onClick={goToUpload} className="text-acc hover:underline font-medium">
            Upload or load a dataset →
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="bg-sub/30 border-b border-border px-6 py-2">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center gap-2 text-acc">
              <Database size={13} />
              <span className="font-mono text-[10px] uppercase tracking-wider">Active</span>
            </div>
            <span className="text-[12px] font-mono font-semibold text-tx truncate" title={file.name}>
              {file.name}
            </span>
            <span className="text-[10px] font-mono text-tx3 hidden sm:inline">
              {formatNumber(file.row_count_approx)} rows · {file.columns?.length || 0} cols
            </span>
            {file.dataset_type && file.dataset_type !== 'general' && (
              <span className="hidden md:inline text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-info/10 text-info border border-info/20">
                {file.dataset_type.replace(/_/g, ' ')}
              </span>
            )}

            <div ref={areaRef} className="relative">
              <button
                onClick={() => setAreaOpen(o => !o)}
                title={currentArea ? `Audit area: ${currentArea.code} — ${currentArea.title}` : 'Tag this dataset to an audit area'}
                className={`flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full border transition-colors ${
                  currentArea
                    ? 'bg-acc/10 text-acc border-acc/30 hover:bg-acc/15'
                    : 'bg-surf text-tx3 border-border hover:text-tx hover:border-tx3'
                }`}
              >
                <FolderOpen size={10} />
                {currentArea ? `${currentArea.code} · ${currentArea.title}` : 'Tag area'}
                <ChevronDown size={9} className={`transition-transform ${areaOpen ? 'rotate-180' : ''}`} />
              </button>
              {areaOpen && (
                <div className="absolute top-full left-0 mt-1 w-80 bg-surf border border-border rounded-xl shadow-lg z-50 overflow-hidden">
                  <div className="px-3 py-2 border-b border-border bg-sub/30 flex items-center justify-between">
                    <span className="font-mono text-[9px] uppercase tracking-wider text-tx3">Audit Area</span>
                    {currentArea && file.dataset_id && (
                      <button
                        onClick={() => { setAuditArea(file.dataset_id!, null); setAreaOpen(false); }}
                        className="text-[9px] font-mono uppercase tracking-wider text-tx3 hover:text-err"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <div className="max-h-96 overflow-y-auto">
                    {groupedAreas.length === 0 && (
                      <div className="px-3 py-4 text-[11px] text-tx3 italic text-center">No areas configured</div>
                    )}
                    {groupedAreas.map(group => (
                      <div key={group.vertical} className="border-b border-border last:border-0">
                        <div className="px-3 py-1.5 bg-sub/20 text-[9px] font-mono uppercase tracking-wider text-tx3 sticky top-0">
                          {VERTICAL_LABELS[group.vertical]}
                        </div>
                        {group.categories.map(c => (
                          <div key={c.category}>
                            <div className="px-3 pt-1.5 pb-0.5 text-[8px] font-mono uppercase tracking-wider text-tx3/70">
                              {CATEGORY_LABELS[c.category] || c.category}
                            </div>
                            {c.areas.map(a => {
                              const isActive = currentArea?.id === a.id;
                              return (
                                <button
                                  key={a.id}
                                  onClick={() => { if (file.dataset_id) setAuditArea(file.dataset_id, a.id); setAreaOpen(false); }}
                                  className={`w-full text-left px-3 py-1 transition-colors flex items-center gap-2 ${
                                    isActive ? 'bg-acc/5 text-acc' : 'hover:bg-sub/40 text-tx2'
                                  }`}
                                >
                                  <span className="font-mono text-[10px] font-bold w-20 truncate">{a.code}</span>
                                  <span className="text-[11px] truncate flex-1">{a.title}</span>
                                </button>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">


            <div ref={ref} className="relative">
              <button
                onClick={() => setOpen(o => !o)}
                className="flex items-center gap-1.5 text-[11px] font-mono text-tx3 hover:text-tx transition-colors px-2 py-1 rounded hover:bg-surf"
              >
                <Layers size={11} />
                Switch
                <ChevronDown size={10} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
              </button>
              {open && (
                <div className="absolute top-full right-0 mt-1 w-72 bg-surf border border-border rounded-xl shadow-lg z-50 overflow-hidden">
                  <div className="px-3 py-2 border-b border-border bg-sub/30">
                    <span className="font-mono text-[9px] uppercase tracking-wider text-tx3">Saved Datasets</span>
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {savedDatasets.length === 0 && (
                      <div className="px-3 py-4 text-[11px] text-tx3 italic text-center">No saved datasets</div>
                    )}
                    {savedDatasets.map(ds => {
                      const isActive = file.dataset_id === ds.id;
                      return (
                        <button
                          key={ds.id}
                          onClick={() => { if (!isActive) loadDataset(ds.id); setOpen(false); }}
                          disabled={loadingDataset === ds.id}
                          className={`w-full text-left px-3 py-2 transition-colors flex items-center justify-between gap-2 ${
                            isActive ? 'bg-acc/5 text-acc' : 'hover:bg-sub/40 text-tx2'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="text-[11px] font-mono font-semibold truncate flex items-center gap-1.5">
                              {ds.audit_area_code && (
                                <span className="text-[9px] font-mono font-bold px-1 py-0.5 rounded bg-acc/10 text-acc">
                                  {ds.audit_area_code.includes(':') ? ds.audit_area_code.split(':')[1] : ds.audit_area_code}
                                </span>
                              )}
                              <span className="truncate">{ds.original_filename}</span>
                            </div>
                            <div className="text-[10px] text-tx3 mt-0.5">
                              {(ds.row_count ?? 0).toLocaleString()} rows
                              {ds.file_type && <> · {ds.file_type.toUpperCase()}</>}
                            </div>
                          </div>
                          {isActive && <span className="text-[9px] font-mono text-acc">ACTIVE</span>}
                          {loadingDataset === ds.id && <RefreshCw size={11} className="animate-spin text-tx3" />}
                        </button>
                      );
                    })}
                  </div>
                  <div className="border-t border-border">
                    <button onClick={() => { setOpen(false); goToUpload(); }} className="w-full px-3 py-2 text-[11px] text-acc hover:bg-acc/5 text-left">
                      + Upload new file
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>


    </>
  );
};