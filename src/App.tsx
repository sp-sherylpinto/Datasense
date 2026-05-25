// import { useEffect, useRef, useState } from 'react';
// import { AnimatePresence, motion } from 'framer-motion';
// import { Briefcase } from 'lucide-react';

// import { api } from './lib/api';
// import { useRoute } from './lib/routing';
// import { TABS_BY_ID } from './lib/nav';
// import { normaliseColType, detectColumnType } from './lib/helpers';
// import type { FileMetadata } from './lib/types';

// import { Header } from './components/Header';
// import { Sidebar } from './components/Sidebar';
// import { EngagementPicker, useSelectedEngagement } from './components/EngagementPicker';
// import { ActiveDatasetBar } from './components/ActiveDatasetBar';
// import { ErrorBoundary } from './components/ErrorBoundary';
// import { EmptyState } from './components/EmptyState';
// import { ShareModal } from './components/ShareModal';
// import { ToastProvider, useToasts } from './components/Toasts';

// import { useAppStore } from './store/appStore';
// import { useDatasetStore } from './store/datasetStore';
// import { useJobStore } from './store/jobStore';

// import { UploadTab } from './tabs/UploadTab';
// import { DataViewTab } from './tabs/DataViewTab';
// import { WorkbenchTab } from './tabs/WorkbenchTab';
// import { ProfileTab } from './tabs/ProfileTab';
// import { BenfordTab } from './tabs/analysis/BenfordTab';
// import { AnomaliesTab } from './tabs/analysis/AnomaliesTab';
// import { TemporalTab } from './tabs/analysis/TemporalTab';
// import { ClustersTab } from './tabs/analysis/ClustersTab';
// import { NetworkTab } from './tabs/analysis/NetworkTab';
// import { AnalysisTab } from './tabs/AnalysisTab';
// import { InsightsTab } from './tabs/InsightsTab';
// import { AIChatBot } from './components/AIChatBot';

// export default function App() {
//   return (
//     <ToastProvider>
//       <AppInner />
//     </ToastProvider>
//   );
// }

// function AppInner() {
//   const { push: pushToast } = useToasts();
//   const { theme, toggleTheme, currentUser, setCurrentUser } = useAppStore();
//   const { engagementId, setEngagementId, engagement } = useSelectedEngagement();

//   const { route, updateTab, updateDataset } = useRoute();
//   const activeTab = route.tab;

//   const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
//     return localStorage.getItem('sidebarCollapsed') === 'true';
//   });

//   const {
//     file,
//     setFile,
//     columnMappings,
//     setColumnMappings,
//     columnRenames,
//     setColumnRenames,
//     columnOrder,
//     setColumnOrder,
//     savedDatasets,
//     setSavedDatasets,
//     datasetsLoading,
//     setDatasetsLoading,
//     loadingDataset,
//     setLoadingDataset,
//     auditAreas,
//     setAuditAreas,
//     confirmDelete,
//     setConfirmDelete,
//     shareDataset,
//     setShareDataset,
//   } = useDatasetStore();

//   const {
//     jobs,
//     setJobs,
//     cleaning,
//     setCleaning,
//     uploading,
//     setUploading,
//     registerSSE,
//     closeSSE,
//     closeAllSSE,
//   } = useJobStore();

//   useEffect(() => {
//     localStorage.setItem('sidebarCollapsed', isSidebarCollapsed.toString());
//   }, [isSidebarCollapsed]);

//   useEffect(() => {
//     return () => closeAllSSE();
//   }, [closeAllSSE]);

//   useEffect(() => {
//     api.get('/auth/me')
//       .then((r) => {
//         if (r.data?.email) {
//           setCurrentUser({ email: r.data.email, name: r.data.name || r.data.email });
//         }
//       })
//       .catch(() => {});

//     api.get('/datasets')
//       .then((r) => setSavedDatasets(r.data || []))
//       .catch(() => {})
//       .finally(() => setDatasetsLoading(false));

//     api.get('/core/audit-areas')
//       .then((r) => setAuditAreas(r.data || []))
//       .catch(() => {});
//   }, [setCurrentUser, setSavedDatasets, setDatasetsLoading, setAuditAreas]);

//   const setAuditArea = async (datasetId: string, code: string | null) => {
//     try {
//       const r = await api.patch(`/datasets/${datasetId}`, { audit_area_code: code ?? '' });
//       const next = r.data?.audit_area_code ?? null;
//       setSavedDatasets((prev) => prev.map((d) => d.id === datasetId ? { ...d, audit_area_code: next } : d));
//       setFile((prev) => prev && prev.dataset_id === datasetId ? { ...prev, audit_area_code: next } : prev);
//     } catch (err) {
//       console.error('Failed to update audit area', err);
//       pushToast({ tone: 'error', title: 'Could not update audit area' });
//     }
//   };

//   const loadDataset = async (datasetId: string) => {
//     setLoadingDataset(datasetId);
//     try {
//       const ds = (await api.get(`/datasets/${datasetId}`)).data;

//       let cols: string[];
//       let preview: any[];
//       let rowCount: number;

//       if (!ds.file_path || ds.table_name) {
//         const previewRes = await api.post('/workbench/query', {
//           sql: `SELECT * FROM ${ds.table_name} LIMIT 500`,
//         });
//         const previewData = previewRes.data.data?.slice(0, 20) ?? [];
//         cols = previewRes.data.columns || (previewData.length > 0 ? Object.keys(previewData[0]) : []);
//         preview = previewData;
//         rowCount = ds.row_count ?? 0;
//       } else {
//         const previewRes = await api.get('/data', {
//           params: { file_path: ds.file_path, limit: 10, offset: 0 },
//         });
//         cols = previewRes.data?.columns || [];
//         preview = previewRes.data?.data || [];
//         rowCount = previewRes.data?.total_count ?? ds.row_count ?? 0;
//       }

//       const columnMeta: any[] = Array.isArray(ds.columns) ? ds.columns : [];

//       // Build type map using detectColumnType for best accuracy
//       // (backend type → name hints → sample data analysis)
//       const sampleRows = preview.slice(0, 100);
//       const initialMappings: Record<string, string> = {};
//       const initialRenames: Record<string, string> = {};

//       cols.forEach((col: string) => {
//         const meta = columnMeta.find((m: any) => m?.name === col);
//         const backendType = meta?.inferred_type;
//         initialMappings[col] = detectColumnType(col, backendType, sampleRows);
//         initialRenames[col] = col;
//       });

//       setFile({
//         dataset_id: ds.id,
//         file_id: ds.id,
//         file_path: ds.file_path,
//         table_name: ds.table_name,
//         name: ds.original_filename,
//         columns: cols,
//         columnMeta,
//         preview,
//         row_count: rowCount,
//         row_count_approx: rowCount,
//         dataset_type: ds.dataset_type,
//         audit_area_code: ds.audit_area_code ?? null,
//         warnings: [],
//         pii_detected: ds.pii_detected ?? false,
//         pii_summary: ds.pii_summary ?? null,
//       } as FileMetadata);

//       setColumnMappings(initialMappings);
//       setColumnRenames(initialRenames);
//       setColumnOrder(cols);
//       updateDataset(ds.id);
//     } catch (err) {
//       console.error('Failed to load dataset', err);
//     } finally {
//       setLoadingDataset(null);
//     }
//   };

//   const restoredRef = useRef(false);

//   useEffect(() => {
//     if (restoredRef.current) return;
//     if (datasetsLoading) return;
//     if (!route.datasetId) { restoredRef.current = true; return; }
//     if (file?.dataset_id === route.datasetId) { restoredRef.current = true; return; }
//     if (savedDatasets.some((d) => d.id === route.datasetId)) {
//       restoredRef.current = true;
//       loadDataset(route.datasetId);
//     } else {
//       restoredRef.current = true;
//     }
//   }, [datasetsLoading, route.datasetId, savedDatasets, file?.dataset_id]);

//   useEffect(() => {
//     if (file?.dataset_id && route.datasetId !== file.dataset_id) {
//       updateDataset(file.dataset_id);
//     }
//   }, [file?.dataset_id]);

//   const deleteDataset = async (datasetId: string) => {
//     try {
//       await api.delete(`/datasets/${datasetId}`);
//       setSavedDatasets((prev) => prev.filter((d) => d.id !== datasetId));
//       if (file?.dataset_id === datasetId) {
//         setFile(null);
//         setColumnOrder([]);
//         setColumnMappings({});
//         setColumnRenames({});
//         updateDataset(null);
//       }
//     } catch (err) {
//       console.error('Failed to delete dataset', err);
//     } finally {
//       setConfirmDelete(null);
//     }
//   };

//   const subscribeJobSSE = (jobId: string, taskName: string, taskParams: any = {}) => {
//     const es = new EventSource(`/jobs/${jobId}/events?token=dev-token`);
//     registerSSE(jobId, es);

//     es.addEventListener('status', (e) => {
//       try {
//         const data = JSON.parse((e as MessageEvent).data);
//         setJobs((prev) => ({ ...prev, [jobId]: { ...prev[jobId], ...data } }));
//       } catch {}
//     });

//     es.addEventListener('done', (e) => {
//       try {
//         const data = JSON.parse((e as MessageEvent).data);
//         const status = data.status;
//         setJobs((prev) => ({ ...prev, [jobId]: { ...prev[jobId], status } }));
//         if (status === 'failed') {
//           pushToast({ tone: 'error', title: `${taskName.replace(/_/g, ' ')} failed` });
//         }
//         if (taskName === 'run_cleaning') {
//           if (status === 'completed') refreshFileMetadata();
//           setCleaning(false);
//         }
//       } catch {
//       } finally {
//         closeSSE(jobId);
//       }
//     });

//     es.addEventListener('error', () => closeSSE(jobId));
//   };

//   const startJob = async (taskName: string, jobParams: any = {}) => {
//     if (!file) return;
//     try {
//       const fullParams = file.dataset_id
//         ? { ...jobParams, dataset_id: jobParams.dataset_id ?? file.dataset_id }
//         : jobParams;
//       const filePath = file.file_path ?? '';
//       const res = await api.post('/jobs', fullParams, {
//         params: { task_name: taskName, file_path: filePath },
//       });
//       const jobId = res.data.job_id;
//       setJobs((prev) => ({
//         ...prev,
//         [jobId]: { id: jobId, status: 'pending', task_name: taskName, task_params: jobParams },
//       }));
//       subscribeJobSSE(jobId, taskName, jobParams);
//     } catch (err) {
//       console.error('Job start failed', err);
//     }
//   };

//   const handleCleanData = async () => {
//     if (!file) return;

//     // Use detectColumnType for comparison so we compare apples to apples
//     const detectedByName: Record<string, string> = {};
//     const sampleRows = (file.preview || []).slice(0, 100);
//     file.columnMeta?.forEach((m: any) => {
//       if (m?.name) {
//         detectedByName[m.name] = detectColumnType(m.name, m.inferred_type, sampleRows);
//       }
//     });

//     const typesUnchanged = Object.entries(columnMappings).every(
//       ([col, t]) => t === (detectedByName[col] || 'text')
//     );
//     const renames: Record<string, string> = {};
//     Object.entries(columnRenames).forEach(([oldName, currName]) => {
//       if (oldName !== currName) renames[oldName] = currName;
//     });
//     const orderUnchanged = (file.columns || []).every((c, i) => columnOrder[i] === c);

//     if (typesUnchanged && Object.keys(renames).length === 0 && orderUnchanged) {
//       pushToast({
//         tone: 'info',
//         title: 'Nothing to clean',
//         body: 'All detected types are already accepted, no renames, no reorder.',
//         ttlMs: 4000,
//       });
//       return;
//     }

//     setCleaning(true);
//     await startJob('run_cleaning', {
//       mapping: columnMappings,
//       column_order: columnOrder,
//       renames,
//       dataset_id: file.dataset_id,
//     });
//   };

//   const refreshFileMetadata = async () => {
//     try {
//       const tableName = file?.table_name;
//       if (!tableName) return;

//       const previewRes = await api.post('/workbench/query', {
//         sql: `SELECT * FROM ${tableName} LIMIT 500`,
//       });
//       const newColumns = previewRes.data.columns || [];
//       const previewData = previewRes.data.data?.slice(0, 10) ?? [];
//       const totalCount = previewRes.data.row_count ?? previewRes.data.data?.length ?? 0;

//       setFile((prev) =>
//         prev ? { ...prev, columns: newColumns, preview: previewData, row_count_approx: totalCount } : null
//       );

//       if (file?.dataset_id) {
//         const dsRes = await api.get(`/datasets/${file.dataset_id}`);
//         const columnMeta: any[] = Array.isArray(dsRes.data?.columns) ? dsRes.data.columns : [];
//         const sampleRows = previewData.slice(0, 100);

//         const newMappings: Record<string, string> = {};
//         const newRenames: Record<string, string> = {};
//         const newOrder: string[] = [];

//         newColumns.forEach((col: string) => {
//           const meta = columnMeta.find((m: any) => m?.name === col);
//           const backendType = meta?.inferred_type;
//           newMappings[col] = detectColumnType(col, backendType, sampleRows);
//           newRenames[col] = col;
//           newOrder.push(col);
//         });

//         setColumnMappings(newMappings);
//         setColumnRenames(newRenames);
//         setColumnOrder(newOrder);
//       }
//     } catch (err) {
//       console.error('Metadata refresh failed', err);
//     }
//   };

//   const goToUpload = () => updateTab('upload');

//   useEffect(() => {
//     if (activeTab === 'dashboard') { updateTab('upload'); return; }
//     const spec = TABS_BY_ID[activeTab];
//     if (!spec) updateTab('upload');
//   }, [activeTab]);

//   return (
//     <ErrorBoundary>
//       <div className="h-screen bg-bg transition-colors duration-200 flex flex-col overflow-hidden">
//         <Header
//           theme={theme}
//           toggleTheme={toggleTheme}
//           currentUser={currentUser}
//           activeDatasetName={file?.name}
//         />

//         {/* Engagement Context Bar */}
//         <div className="bg-sub/30 border-b border-border px-6 py-2">
//           <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
//             <div className="flex items-center gap-2 text-acc">
//               <Briefcase size={13} />
//               <span className="font-mono text-[10px] uppercase tracking-wider">Engagement</span>
//             </div>
//             <EngagementPicker engagementId={engagementId} onChange={setEngagementId} />
//           </div>
//         </div>

//         {/* Main Layout */}
//         <div className="flex flex-1 overflow-hidden relative">
//           <Sidebar
//             activeTab={activeTab}
//             onChange={updateTab}
//             fileLoaded={!!file}
//             isCollapsed={isSidebarCollapsed}
//             onToggle={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
//           />

//           <div className="flex-1 flex flex-col overflow-hidden min-w-0 ml-0">
//             <ActiveDatasetBar
//               file={file}
//               savedDatasets={savedDatasets}
//               loadDataset={loadDataset}
//               loadingDataset={loadingDataset}
//               goToUpload={goToUpload}
//               auditAreas={auditAreas}
//               setAuditArea={setAuditArea}
//               engagementVertical={engagement?.vertical || null}
//             />

//             <main className="flex-1 overflow-auto bg-bg">
//               <div className="w-full p-4">
//                 <AnimatePresence mode="wait">
//                   <motion.div
//                     key={activeTab}
//                     initial={{ opacity: 0, y: 10 }}
//                     animate={{ opacity: 1, y: 0 }}
//                     exit={{ opacity: 0, y: -10 }}
//                     transition={{ duration: 0.18 }}
//                   >
//                     {/* ── Upload ── */}
//                     {activeTab === 'upload' && (
//                       <UploadTab
//                         file={file}
//                         setFile={setFile}
//                         uploading={uploading}
//                         setUploading={setUploading}
//                         cleaning={cleaning}
//                         handleCleanData={handleCleanData}
//                         columnMappings={columnMappings}
//                         setColumnMappings={setColumnMappings}
//                         setColumnRenames={setColumnRenames}
//                         setColumnOrder={setColumnOrder}
//                         savedDatasets={savedDatasets}
//                         setSavedDatasets={setSavedDatasets}
//                         datasetsLoading={datasetsLoading}
//                         loadingDataset={loadingDataset}
//                         loadDataset={loadDataset}
//                         confirmDelete={confirmDelete}
//                         setConfirmDelete={setConfirmDelete}
//                         deleteDataset={deleteDataset}
//                         shareDataset={(ds) => setShareDataset(ds)}
//                         goTo={updateTab}
//                         engagementId={engagementId}
//                       />
//                     )}

//                     {/* ── Quality Profile ── */}
//                     {activeTab === 'profile' && (
//                       <ProfileTab
//                         file={file}
//                         startJob={startJob}
//                         jobs={jobs}
//                         goToUpload={goToUpload}
//                       />
//                     )}

//                     {/* ── SQL Workbench ── */}
//                     {activeTab === 'workbench' && <WorkbenchTab />}

//                     {/* ── Data View ── */}
//                     {activeTab === 'dataview' &&
//                       (file ? (
//                         <DataViewTab
//                           file={file}
//                           columnMappings={columnMappings}
//                           setColumnMappings={setColumnMappings}
//                           columnRenames={columnRenames}
//                           setColumnRenames={setColumnRenames}
//                           columnOrder={columnOrder}
//                           setColumnOrder={setColumnOrder}
//                           handleCleanData={handleCleanData}
//                           cleaning={cleaning}
//                           auditAreas={auditAreas}
//                           engagement={engagement}
//                         />
//                       ) : (
//                         <EmptyState
//                           goToUpload={goToUpload}
//                           message="Upload or load a dataset to browse, sort, filter and export records."
//                         />
//                       ))}

//                     {/* ── Analysis Tabs ── */}
//                     {activeTab === 'benford' &&
//                       (file ? (
//                         <BenfordTab file={file} startJob={startJob} jobs={jobs} />
//                       ) : (
//                         <EmptyState goToUpload={goToUpload} />
//                       ))}

//                     {activeTab === 'outliers' &&
//                       (file ? (
//                         <AnomaliesTab file={file} startJob={startJob} jobs={jobs} />
//                       ) : (
//                         <EmptyState goToUpload={goToUpload} />
//                       ))}

//                     {activeTab === 'timeseries' &&
//                       (file ? (
//                         <TemporalTab file={file} startJob={startJob} jobs={jobs} />
//                       ) : (
//                         <EmptyState goToUpload={goToUpload} />
//                       ))}

//                     {activeTab === 'clustering' &&
//                       (file ? (
//                         <ClustersTab file={file} startJob={startJob} jobs={jobs} />
//                       ) : (
//                         <EmptyState goToUpload={goToUpload} />
//                       ))}

//                     {activeTab === 'network' &&
//                       (file ? (
//                         <NetworkTab file={file} startJob={startJob} jobs={jobs} />
//                       ) : (
//                         <EmptyState goToUpload={goToUpload} />
//                       ))}

//                     {activeTab === 'analyse' &&
//                       (file ? (
//                         <AnalysisTab file={file} startJob={startJob} jobs={jobs} />
//                       ) : (
//                         <EmptyState goToUpload={goToUpload} />
//                       ))}

//                     {/* ── Insights Report ── */}
//                     {activeTab === 'insights' &&
//                       (file ? (
//                         <InsightsTab file={file} jobs={jobs} />
//                       ) : (
//                         <EmptyState
//                           goToUpload={goToUpload}
//                           message="Upload or load a dataset first to generate an insights report."
//                         />
//                       ))}

//                   </motion.div>
//                 </AnimatePresence>
//               </div>

//               {/* Footer inside scroll area — only visible at bottom */}
//               <footer className="border-t border-border bg-[#9a3324] py-3 text-center mt-4">
//                 <p className="text-xs text-white/80 font-mono">
//                   © Varma &amp; Varma Chartered Accountants ·{' '}
//                   {new Date()
//                     .toLocaleDateString('en-GB', { year: 'numeric', month: '2-digit' })
//                     .replace('/', '.')}
//                 </p>
//               </footer>
//             </main>
//           </div>
//         </div>

//         {shareDataset && (
//           <ShareModal
//             datasetId={shareDataset.id}
//             datasetName={shareDataset.original_filename || (shareDataset as any).name}
//             currentUser={currentUser?.email || 'api'}
//             onClose={() => setShareDataset(null)}
//           />
//         )}

//         {/* AI Chatbot — floats over all content */}
//         <AIChatBot file={file} />
//       </div>
//     </ErrorBoundary>
//   );
// }


import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Briefcase } from 'lucide-react';

import { api } from './lib/api';
import { useRoute } from './lib/routing';
import { TABS_BY_ID } from './lib/nav';
import { normaliseColType, detectColumnType } from './lib/helpers';
import type { FileMetadata } from './lib/types';

import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { EngagementPicker, useSelectedEngagement } from './components/EngagementPicker';
import { ActiveDatasetBar } from './components/ActiveDatasetBar';
import { ErrorBoundary } from './components/ErrorBoundary';
import { EmptyState } from './components/EmptyState';
import { ShareModal } from './components/ShareModal';
import { ToastProvider, useToasts } from './components/Toasts';

import { useAppStore } from './store/appStore';
import { useDatasetStore } from './store/datasetStore';
import { useJobStore } from './store/jobStore';

import { UploadTab } from './tabs/UploadTab';
import { DataViewTab } from './tabs/DataViewTab';
import { WorkbenchTab } from './tabs/WorkbenchTab';
import { ProfileTab } from './tabs/ProfileTab';
import { BenfordTab } from './tabs/analysis/BenfordTab';
import { AnomaliesTab } from './tabs/analysis/AnomaliesTab';
import { TemporalTab } from './tabs/analysis/TemporalTab';
import { ClustersTab } from './tabs/analysis/ClustersTab';
import { NetworkTab } from './tabs/analysis/NetworkTab';
import { AnalysisTab } from './tabs/AnalysisTab';
import { InsightsTab } from './tabs/InsightsTab';
import { AIChatBot } from './components/AIChatBot';

export default function App() {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  );
}

function AppInner() {
  const { push: pushToast } = useToasts();
  const { theme, toggleTheme, currentUser, setCurrentUser } = useAppStore();
  const { engagementId, setEngagementId, engagement } = useSelectedEngagement();

  const { route, updateTab, updateDataset } = useRoute();
  const activeTab = route.tab;

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('sidebarCollapsed') === 'true';
  });

  const {
    file,
    setFile,
    columnMappings,
    setColumnMappings,
    columnRenames,
    setColumnRenames,
    columnOrder,
    setColumnOrder,
    savedDatasets,
    setSavedDatasets,
    datasetsLoading,
    setDatasetsLoading,
    loadingDataset,
    setLoadingDataset,
    auditAreas,
    setAuditAreas,
    confirmDelete,
    setConfirmDelete,
    shareDataset,
    setShareDataset,
  } = useDatasetStore();

  const {
    jobs,
    setJobs,
    cleaning,
    setCleaning,
    uploading,
    setUploading,
    registerSSE,
    closeSSE,
    closeAllSSE,
  } = useJobStore();

  useEffect(() => {
    localStorage.setItem('sidebarCollapsed', isSidebarCollapsed.toString());
  }, [isSidebarCollapsed]);

  useEffect(() => {
    return () => closeAllSSE();
  }, [closeAllSSE]);

  useEffect(() => {
    api.get('/auth/me')
      .then((r) => {
        if (r.data?.email) {
          setCurrentUser({ email: r.data.email, name: r.data.name || r.data.email });
        }
      })
      .catch(() => {});

    api.get('/datasets')
      .then((r) => setSavedDatasets(r.data || []))
      .catch(() => {})
      .finally(() => setDatasetsLoading(false));

    api.get('/core/audit-areas')
      .then((r) => setAuditAreas(r.data || []))
      .catch(() => {});
  }, [setCurrentUser, setSavedDatasets, setDatasetsLoading, setAuditAreas]);

  const setAuditArea = async (datasetId: string, code: string | null) => {
    try {
      const r = await api.patch(`/datasets/${datasetId}`, { audit_area_code: code ?? '' });
      const next = r.data?.audit_area_code ?? null;
      setSavedDatasets((prev) => prev.map((d) => d.id === datasetId ? { ...d, audit_area_code: next } : d));
      setFile((prev) => prev && prev.dataset_id === datasetId ? { ...prev, audit_area_code: next } : prev);
    } catch (err) {
      console.error('Failed to update audit area', err);
      pushToast({ tone: 'error', title: 'Could not update audit area' });
    }
  };

  const loadDataset = async (datasetId: string) => {
    setLoadingDataset(datasetId);
    try {
      const ds = (await api.get(`/datasets/${datasetId}`)).data;

      let cols: string[];
      let preview: any[];
      let rowCount: number;

      if (!ds.file_path || ds.table_name) {
        const previewRes = await api.post('/workbench/query', {
          sql: `SELECT * FROM ${ds.table_name} LIMIT 500`,
        });
        const previewData = previewRes.data.data?.slice(0, 20) ?? [];
        cols = previewRes.data.columns || (previewData.length > 0 ? Object.keys(previewData[0]) : []);
        preview = previewData;
        rowCount = ds.row_count ?? 0;
      } else {
        const previewRes = await api.get('/data', {
          params: { file_path: ds.file_path, limit: 10, offset: 0 },
        });
        cols = previewRes.data?.columns || [];
        preview = previewRes.data?.data || [];
        rowCount = previewRes.data?.total_count ?? ds.row_count ?? 0;
      }

      const columnMeta: any[] = Array.isArray(ds.columns) ? ds.columns : [];

      // Build type map using detectColumnType for best accuracy
      // (backend type → name hints → sample data analysis)
      const sampleRows = preview.slice(0, 100);
      const initialMappings: Record<string, string> = {};
      const initialRenames: Record<string, string> = {};

      cols.forEach((col: string) => {
        const meta = columnMeta.find((m: any) => m?.name === col);
        const backendType = meta?.inferred_type;
        initialMappings[col] = detectColumnType(col, backendType, sampleRows);
        initialRenames[col] = col;
      });

      setFile({
        dataset_id: ds.id,
        file_id: ds.id,
        file_path: ds.file_path,
        table_name: ds.table_name,
        name: ds.original_filename,
        columns: cols,
        columnMeta,
        preview,
        row_count: rowCount,
        row_count_approx: rowCount,
        dataset_type: ds.dataset_type,
        audit_area_code: ds.audit_area_code ?? null,
        warnings: [],
        pii_detected: ds.pii_detected ?? false,
        pii_summary: ds.pii_summary ?? null,
      } as FileMetadata);

      setColumnMappings(initialMappings);
      setColumnRenames(initialRenames);
      setColumnOrder(cols);
      updateDataset(ds.id);
    } catch (err) {
      console.error('Failed to load dataset', err);
    } finally {
      setLoadingDataset(null);
    }
  };

  const restoredRef = useRef(false);

  useEffect(() => {
    if (restoredRef.current) return;
    if (datasetsLoading) return;
    if (!route.datasetId) { restoredRef.current = true; return; }
    if (file?.dataset_id === route.datasetId) { restoredRef.current = true; return; }
    if (savedDatasets.some((d) => d.id === route.datasetId)) {
      restoredRef.current = true;
      loadDataset(route.datasetId);
    } else {
      restoredRef.current = true;
    }
  }, [datasetsLoading, route.datasetId, savedDatasets, file?.dataset_id]);

  useEffect(() => {
    if (file?.dataset_id && route.datasetId !== file.dataset_id) {
      updateDataset(file.dataset_id);
    }
  }, [file?.dataset_id]);

  const deleteDataset = async (datasetId: string) => {
    try {
      await api.delete(`/datasets/${datasetId}`);
      setSavedDatasets((prev) => prev.filter((d) => d.id !== datasetId));
      if (file?.dataset_id === datasetId) {
        setFile(null);
        setColumnOrder([]);
        setColumnMappings({});
        setColumnRenames({});
        updateDataset(null);
      }
    } catch (err) {
      console.error('Failed to delete dataset', err);
    } finally {
      setConfirmDelete(null);
    }
  };

  const subscribeJobSSE = (jobId: string, taskName: string, taskParams: any = {}) => {
    const es = new EventSource(`/jobs/${jobId}/events?token=dev-token`);
    registerSSE(jobId, es);

    es.addEventListener('status', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data);
        setJobs((prev) => ({ ...prev, [jobId]: { ...prev[jobId], ...data } }));
      } catch {}
    });

    es.addEventListener('done', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data);
        const status = data.status;
        setJobs((prev) => ({ ...prev, [jobId]: { ...prev[jobId], status } }));
        if (status === 'failed') {
          pushToast({ tone: 'error', title: `${taskName.replace(/_/g, ' ')} failed` });
        }
        if (taskName === 'run_cleaning') {
          if (status === 'completed') refreshFileMetadata();
          setCleaning(false);
        }
      } catch {
      } finally {
        closeSSE(jobId);
      }
    });

    es.addEventListener('error', () => closeSSE(jobId));
  };

  const startJob = async (taskName: string, jobParams: any = {}) => {
    if (!file) return;
    try {
      const fullParams = file.dataset_id
        ? { ...jobParams, dataset_id: jobParams.dataset_id ?? file.dataset_id }
        : jobParams;
      const filePath = file.file_path ?? '';
      const res = await api.post('/jobs', fullParams, {
        params: { task_name: taskName, file_path: filePath },
      });
      const jobId = res.data.job_id;
      setJobs((prev) => ({
        ...prev,
        [jobId]: { id: jobId, status: 'pending', task_name: taskName, task_params: jobParams },
      }));
      subscribeJobSSE(jobId, taskName, jobParams);
    } catch (err) {
      console.error('Job start failed', err);
    }
  };

  const handleCleanData = async () => {
    if (!file) return;

    // Use detectColumnType for comparison so we compare apples to apples
    const detectedByName: Record<string, string> = {};
    const sampleRows = (file.preview || []).slice(0, 100);
    file.columnMeta?.forEach((m: any) => {
      if (m?.name) {
        detectedByName[m.name] = detectColumnType(m.name, m.inferred_type, sampleRows);
      }
    });

    const typesUnchanged = Object.entries(columnMappings).every(
      ([col, t]) => t === (detectedByName[col] || 'text')
    );
    const renames: Record<string, string> = {};
    Object.entries(columnRenames).forEach(([oldName, currName]) => {
      if (oldName !== currName) renames[oldName] = currName;
    });
    const orderUnchanged = (file.columns || []).every((c, i) => columnOrder[i] === c);

    if (typesUnchanged && Object.keys(renames).length === 0 && orderUnchanged) {
      pushToast({
        tone: 'info',
        title: 'Nothing to clean',
        body: 'All detected types are already accepted, no renames, no reorder.',
        ttlMs: 4000,
      });
      return;
    }

    setCleaning(true);
    await startJob('run_cleaning', {
      mapping: columnMappings,
      column_order: columnOrder,
      renames,
      dataset_id: file.dataset_id,
    });
  };

  const refreshFileMetadata = async () => {
    try {
      const tableName = file?.table_name;
      if (!tableName) return;

      const previewRes = await api.post('/workbench/query', {
        sql: `SELECT * FROM ${tableName} LIMIT 500`,
      });
      const newColumns = previewRes.data.columns || [];
      const previewData = previewRes.data.data?.slice(0, 10) ?? [];
      const totalCount = previewRes.data.row_count ?? previewRes.data.data?.length ?? 0;

      setFile((prev) =>
        prev ? { ...prev, columns: newColumns, preview: previewData, row_count_approx: totalCount } : null
      );

      if (file?.dataset_id) {
        const dsRes = await api.get(`/datasets/${file.dataset_id}`);
        const columnMeta: any[] = Array.isArray(dsRes.data?.columns) ? dsRes.data.columns : [];
        const sampleRows = previewData.slice(0, 100);

        const newMappings: Record<string, string> = {};
        const newRenames: Record<string, string> = {};
        const newOrder: string[] = [];

        newColumns.forEach((col: string) => {
          const meta = columnMeta.find((m: any) => m?.name === col);
          const backendType = meta?.inferred_type;
          newMappings[col] = detectColumnType(col, backendType, sampleRows);
          newRenames[col] = col;
          newOrder.push(col);
        });

        setColumnMappings(newMappings);
        setColumnRenames(newRenames);
        setColumnOrder(newOrder);
      }
    } catch (err) {
      console.error('Metadata refresh failed', err);
    }
  };

  const goToUpload = () => updateTab('upload');

  useEffect(() => {
    if (activeTab === 'dashboard') { updateTab('upload'); return; }
    const spec = TABS_BY_ID[activeTab];
    if (!spec) updateTab('upload');
  }, [activeTab]);

  return (
    <ErrorBoundary>
      <div className="h-screen bg-bg transition-colors duration-200 flex flex-col overflow-hidden">
        <Header
          theme={theme}
          toggleTheme={toggleTheme}
          currentUser={currentUser}
          activeDatasetName={file?.name}
        />

        {/* Engagement Context Bar */}
        <div className="bg-sub/30 border-b border-border px-6 py-2">
          <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-acc">
              <Briefcase size={13} />
              <span className="font-mono text-[10px] uppercase tracking-wider">Engagement</span>
            </div>
            <EngagementPicker engagementId={engagementId} onChange={setEngagementId} />
          </div>
        </div>

        {/* Main Layout */}
        <div className="flex flex-1 overflow-hidden relative">
          <Sidebar
            activeTab={activeTab}
            onChange={updateTab}
            fileLoaded={!!file}
            isCollapsed={isSidebarCollapsed}
            onToggle={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          />

          <div className="flex-1 flex flex-col overflow-hidden min-w-0 ml-0">
            <ActiveDatasetBar
              file={file}
              savedDatasets={savedDatasets}
              loadDataset={loadDataset}
              loadingDataset={loadingDataset}
              goToUpload={goToUpload}
              auditAreas={auditAreas}
              setAuditArea={setAuditArea}
              engagementVertical={engagement?.vertical || null}
              columnMappings={columnMappings}
              setColumnMappings={setColumnMappings}
              columnRenames={columnRenames}
              setColumnRenames={setColumnRenames}
              columnOrder={columnOrder}
              setColumnOrder={setColumnOrder}
              handleCleanData={handleCleanData}
              cleaning={cleaning}
              activeTab={activeTab}
            />

            <main className="flex-1 overflow-auto bg-bg">
              <div className="w-full p-4">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeTab}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.18 }}
                  >
                    {/* ── Upload ── */}
                    {activeTab === 'upload' && (
                      <UploadTab
                        file={file}
                        setFile={setFile}
                        uploading={uploading}
                        setUploading={setUploading}
                        cleaning={cleaning}
                        handleCleanData={handleCleanData}
                        columnMappings={columnMappings}
                        setColumnMappings={setColumnMappings}
                        setColumnRenames={setColumnRenames}
                        setColumnOrder={setColumnOrder}
                        savedDatasets={savedDatasets}
                        setSavedDatasets={setSavedDatasets}
                        datasetsLoading={datasetsLoading}
                        loadingDataset={loadingDataset}
                        loadDataset={loadDataset}
                        confirmDelete={confirmDelete}
                        setConfirmDelete={setConfirmDelete}
                        deleteDataset={deleteDataset}
                        shareDataset={(ds) => setShareDataset(ds)}
                        goTo={updateTab}
                        engagementId={engagementId}
                      />
                    )}

                    {/* ── Quality Profile ── */}
                    {activeTab === 'profile' && (
                      <ProfileTab
                        file={file}
                        startJob={startJob}
                        jobs={jobs}
                        goToUpload={goToUpload}
                      />
                    )}

                    {/* ── SQL Workbench ── */}
                    {activeTab === 'workbench' && <WorkbenchTab />}

                    {/* ── Data View ── */}
                    {activeTab === 'dataview' &&
                      (file ? (
                        <DataViewTab
                          file={file}
                          columnMappings={columnMappings}
                          setColumnMappings={setColumnMappings}
                          columnRenames={columnRenames}
                          setColumnRenames={setColumnRenames}
                          columnOrder={columnOrder}
                          setColumnOrder={setColumnOrder}
                          handleCleanData={handleCleanData}
                          cleaning={cleaning}
                          auditAreas={auditAreas}
                          engagement={engagement}
                        />
                      ) : (
                        <EmptyState
                          goToUpload={goToUpload}
                          message="Upload or load a dataset to browse, sort, filter and export records."
                        />
                      ))}

                    {/* ── Analysis Tabs ── */}
                    {activeTab === 'benford' &&
                      (file ? (
                        <BenfordTab file={file} startJob={startJob} jobs={jobs} />
                      ) : (
                        <EmptyState goToUpload={goToUpload} />
                      ))}

                    {activeTab === 'outliers' &&
                      (file ? (
                        <AnomaliesTab file={file} startJob={startJob} jobs={jobs} />
                      ) : (
                        <EmptyState goToUpload={goToUpload} />
                      ))}

                    {activeTab === 'timeseries' &&
                      (file ? (
                        <TemporalTab file={file} startJob={startJob} jobs={jobs} />
                      ) : (
                        <EmptyState goToUpload={goToUpload} />
                      ))}

                    {activeTab === 'clustering' &&
                      (file ? (
                        <ClustersTab file={file} startJob={startJob} jobs={jobs} />
                      ) : (
                        <EmptyState goToUpload={goToUpload} />
                      ))}

                    {activeTab === 'network' &&
                      (file ? (
                        <NetworkTab file={file} startJob={startJob} jobs={jobs} />
                      ) : (
                        <EmptyState goToUpload={goToUpload} />
                      ))}

                    {activeTab === 'analyse' &&
                      (file ? (
                        <AnalysisTab file={file} startJob={startJob} jobs={jobs} />
                      ) : (
                        <EmptyState goToUpload={goToUpload} />
                      ))}

                    {/* ── Insights Report ── */}
                    {activeTab === 'insights' &&
                      (file ? (
                        <InsightsTab file={file} jobs={jobs} />
                      ) : (
                        <EmptyState
                          goToUpload={goToUpload}
                          message="Upload or load a dataset first to generate an insights report."
                        />
                      ))}

                  </motion.div>
                </AnimatePresence>
              </div>

              {/* Footer inside scroll area — only visible at bottom */}
              <footer className="border-t border-border bg-[#9a3324] py-3 text-center mt-4">
                <p className="text-xs text-white/80 font-mono">
                  © Varma &amp; Varma Chartered Accountants ·{' '}
                  {new Date()
                    .toLocaleDateString('en-GB', { year: 'numeric', month: '2-digit' })
                    .replace('/', '.')}
                </p>
              </footer>
            </main>
          </div>
        </div>

        {shareDataset && (
          <ShareModal
            datasetId={shareDataset.id}
            datasetName={shareDataset.original_filename || (shareDataset as any).name}
            currentUser={currentUser?.email || 'api'}
            onClose={() => setShareDataset(null)}
          />
        )}

        {/* AI Chatbot — floats over all content */}
        
        <AIChatBot file={file} />
      </div>
    </ErrorBoundary>
  );
}
