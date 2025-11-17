/**
 * Cognigy API client for making HTTP requests
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { logger } from '../utils/logger.js';

export interface CognigyApiClientConfig {
  baseUrl: string;
  apiKey: string;
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

    // Add request interceptor for authentication
    this.client.interceptors.request.use(
      (config) => {
        config.headers['X-API-Key'] = this.apiKey;
        logger.debug(`API Request: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        logger.error('API Request Error', { error: error.message });
        return Promise.reject(error);
      }
    );

    // Add response interceptor for logging
    this.client.interceptors.response.use(
      (response) => {
        logger.debug(`API Response: ${response.status} ${response.config.url}`);
        return response;
      },
      (error) => {
        const status = error.response?.status || 'N/A';
        const message = error.response?.data?.detail || error.message;
        const traceId = error.response?.data?.traceId;
        
        logger.error('API Response Error', {
          status,
          message,
          traceId,
          url: error.config?.url,
        });
        
        return Promise.reject(this.formatError(error));
      }
    );
  }

  /**
   * Format error responses according to RFC 7807
   */
  private formatError(error: any): Error {
    if (error.response?.data) {
      const data = error.response.data;
      const message = data.detail || data.title || 'API request failed';
      const enhancedError = new Error(message);
      (enhancedError as any).status = data.status || error.response.status;
      (enhancedError as any).code = data.code;
      (enhancedError as any).traceId = data.traceId;
      (enhancedError as any).details = data.details;
      return enhancedError;
    }
    return error;
  }

  /**
   * Make a GET request
   */
  async get<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response: AxiosResponse<T> = await this.client.get(url, config);
    return response.data;
  }

  /**
   * Make a POST request
   */
  async post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const response: AxiosResponse<T> = await this.client.post(url, data, config);
    return response.data;
  }

  /**
   * Make a PUT request
   */
  async put<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const response: AxiosResponse<T> = await this.client.put(url, data, config);
    return response.data;
  }

  /**
   * Make a PATCH request
   */
  async patch<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const response: AxiosResponse<T> = await this.client.patch(url, data, config);
    return response.data;
  }

  /**
   * Make a DELETE request
   */
  async delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response: AxiosResponse<T> = await this.client.delete(url, config);
    return response.data;
  }
}

