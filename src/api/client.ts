import { ReadStream } from 'fs';
import axios, { AxiosError, AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import FormData from 'form-data';
import { logger } from '../utils/logger.js';

export interface CognigyApiClientConfig {
  baseUrl: string;
  apiKey: string;
}

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;

const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND',
  'EAI_AGAIN', 'EPIPE', 'ERR_NETWORK',
]);

function isRetryable(error: AxiosError): boolean {
  if (error.response) {
    const status = error.response.status;
    return status === 429 || status >= 500;
  }
  return RETRYABLE_NETWORK_CODES.has(error.code ?? '');
}

export class CognigyApiClient {
  private client: AxiosInstance;
  private apiKey: string;

  constructor(config: CognigyApiClientConfig) {
    this.apiKey = config.apiKey;
    this.client = axios.create({
      baseURL: config.baseUrl,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      timeout: 30000,
    });

    this.client.interceptors.request.use(
      (reqConfig) => {
        reqConfig.headers['X-API-Key'] = this.apiKey;
        logger.debug(`API Request: ${reqConfig.method?.toUpperCase()} ${reqConfig.url}`);
        return reqConfig;
      },
      (error) => {
        logger.error('API Request Error', { error: error.message });
        return Promise.reject(error);
      }
    );

    this.client.interceptors.response.use(
      (response) => {
        logger.debug(`API Response: ${response.status} ${response.config.url}`);
        return response;
      },
      async (error: AxiosError) => {
        const config = error.config as AxiosRequestConfig & { _retryCount?: number };
        const status = error.response?.status ?? 0;

        if (config && isRetryable(error)) {
          config._retryCount = (config._retryCount ?? 0) + 1;
          if (config._retryCount <= MAX_RETRIES) {
            const delay = RETRY_BASE_MS * Math.pow(2, config._retryCount - 1);
            logger.warn(`Retrying request (${config._retryCount}/${MAX_RETRIES}) after ${delay}ms`, {
              status,
              url: config.url,
            });
            await new Promise(r => setTimeout(r, delay));
            return this.client.request(config);
          }
        }

        const message = (error.response?.data as any)?.detail || error.message;
        const traceId = (error.response?.data as any)?.traceId;

        logger.error('API Response Error', {
          status: status || 'N/A',
          message,
          traceId,
          url: config?.url,
        });

        return Promise.reject(this.formatError(error));
      }
    );
  }

  private formatError(error: AxiosError): Error {
    const data = error.response?.data as any;
    if (data) {
      const message = data.detail || data.title || 'API request failed';
      const enhancedError = new Error(message);
      (enhancedError as any).status = data.status || error.response?.status;
      (enhancedError as any).code = data.code;
      (enhancedError as any).traceId = data.traceId;
      (enhancedError as any).details = data.details;
      return enhancedError;
    }
    return error;
  }

  async get<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response: AxiosResponse<T> = await this.client.get(url, config);
    return response.data;
  }

  async post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const response: AxiosResponse<T> = await this.client.post(url, data, config);
    return response.data;
  }

  async put<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const response: AxiosResponse<T> = await this.client.put(url, data, config);
    return response.data;
  }

  async patch<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const response: AxiosResponse<T> = await this.client.patch(url, data, config);
    return response.data;
  }

  async delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response: AxiosResponse<T> = await this.client.delete(url, config);
    return response.data;
  }

  async uploadFile<T = any>(
    url: string,
    fileData: Buffer | ReadStream,
    fileName: string,
    extraFields?: Record<string, string>,
    options?: { timeoutMs?: number },
  ): Promise<T> {
    const form = new FormData();
    form.append('file', fileData, { filename: fileName });
    if (extraFields) {
      for (const [key, value] of Object.entries(extraFields)) {
        form.append(key, value);
      }
    }
    const response: AxiosResponse<T> = await this.client.post(url, form, {
      headers: {
        ...form.getHeaders(),
        'X-API-Key': this.apiKey,
      },
      timeout: options?.timeoutMs ?? 120000,
    });
    return response.data;
  }
}
