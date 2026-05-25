import axios from 'axios';

const API_TOKEN = (import.meta.env.VITE_API_AUTH_TOKEN || 'dev-token').trim();

export const api = axios.create({
  baseURL: '/',
  headers: { 'X-API-Token': API_TOKEN },
});

api.interceptors.request.use((config) => {
  config.headers['X-API-Token'] = API_TOKEN;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (!err.response) {
      window.location.reload();
    }
    return Promise.reject(err);
  }
);

export { API_TOKEN };
