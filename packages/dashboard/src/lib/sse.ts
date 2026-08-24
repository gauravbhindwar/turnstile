import { getAdminToken } from "./auth.js";

export interface SseHandle {
  close: () => void;
}

// Hand-rolled SSE client (not EventSource) because EventSource can't set
// an Authorization header, and the admin API's SSE route requires one.
export function subscribeToEvents(onEvent: (type: string, data: unknown) => void, onError?: (err: Error) => void): SseHandle {
  const controller = new AbortController();

  (async () => {
    try {
      const token = getAdminToken();
      const response = await fetch("/admin/v1/events/stream", {
        headers: token ? { authorization: `Bearer ${token}` } : {},
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        onError?.(new Error(`SSE connect failed: ${response.status}`));
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let boundary: number;
        while ((boundary = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const lines = frame.split("\n");
          const eventLine = lines.find((l) => l.startsWith("event: "));
          const dataLine = lines.find((l) => l.startsWith("data: "));
          if (!eventLine || !dataLine) continue;
          try {
            onEvent(eventLine.slice("event: ".length), JSON.parse(dataLine.slice("data: ".length)));
          } catch {
            // malformed frame — skip it, the stream continues
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        onError?.(err as Error);
      }
    }
  })();

  return { close: () => controller.abort() };
}
