"use client";

import { useEffect, useState } from "react";
import { apiGet, type ApiEnvelope } from "./api";

export type ApiState<T> = { data?: ApiEnvelope<T>; loading: boolean; error?: string };

export function useApi<T>(path: string, params?: Record<string, string | number | undefined>, refreshKey = 0): ApiState<T> {
  const query = JSON.stringify(params ?? {});
  const [state, setState] = useState<ApiState<T>>({ loading: true });
  useEffect(() => {
    const controller = new AbortController();
    setState({ loading: true });
    void apiGet<T>(path, JSON.parse(query) as Record<string, string | number | undefined>, controller.signal)
      .then((data) => setState({ data, loading: false }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ loading: false, error: error instanceof Error ? error.message : "Request failed" });
      });
    return () => controller.abort();
  }, [path, query, refreshKey]);
  return state;
}
