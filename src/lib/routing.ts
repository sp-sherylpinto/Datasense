import { useEffect, useState, useCallback } from 'react';
import type { TabType } from './types';
import { isValidTabId } from './nav';

interface RouteState {
  tab: TabType;
  datasetId: string | null;
}

const readRoute = (): RouteState => {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get('tab');
  const datasetId = params.get('ds');
  return {
    tab: isValidTabId(tab) ? tab : 'upload',
    datasetId: datasetId || null,
  };
};

const writeRoute = (state: RouteState, replace = false) => {
  const params = new URLSearchParams();
  params.set('tab', state.tab);
  if (state.datasetId) params.set('ds', state.datasetId);
  const url = `${window.location.pathname}?${params.toString()}`;
  if (replace) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
};

export const useRoute = () => {
  const [route, setRoute] = useState<RouteState>(readRoute);

  useEffect(() => {
    const onPop = () => setRoute(readRoute());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const updateTab = useCallback((tab: TabType) => {
    setRoute(prev => {
      if (prev.tab === tab) return prev;
      const next = { ...prev, tab };
      writeRoute(next);
      return next;
    });
  }, []);

  const updateDataset = useCallback((datasetId: string | null) => {
    setRoute(prev => {
      if (prev.datasetId === datasetId) return prev;
      const next = { ...prev, datasetId };
      writeRoute(next, true);
      return next;
    });
  }, []);

  return { route, updateTab, updateDataset };
};