import axios from 'axios';

const getBaseURL = () => {
  const url = import.meta.env.VITE_API_URL || 'http://localhost:5000';
  return url.endsWith('/api') ? url : `${url}/api`;
};

const api = axios.create({
  baseURL: getBaseURL()
});

export default api;
