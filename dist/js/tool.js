// Optional WebMCP-style tool so an in-page agent can tune the response.

const MIN_SENSITIVITY = 0.3;
const MAX_SENSITIVITY = 3;
const MIN_SMOOTHING = 0;
const MAX_SMOOTHING = 95;

function isInRange(value, min, max) {
  return Number.isFinite(value) && value >= min && value <= max;
}

/**
 * controls: { apply({ sensitivity, smoothing }), read() -> { sensitivity, smoothing } }
 * smoothing is a percentage (0-95), matching the slider.
 */
export function registerResponseTool(controls) {
  const registry = document.modelContext;
  if (!registry?.registerTool) return;
  try {
    Promise.resolve(
      registry.registerTool({
        name: 'configure_reactor_response',
        description: 'Adjust the reactor audio visualizer sensitivity and motion smoothing.',
        inputSchema: {
          type: 'object',
          properties: {
            sensitivity: { type: 'number', minimum: MIN_SENSITIVITY, maximum: MAX_SENSITIVITY },
            smoothing: { type: 'number', minimum: MIN_SMOOTHING, maximum: MAX_SMOOTHING },
          },
          required: ['sensitivity', 'smoothing'],
          additionalProperties: false,
        },
        execute(input) {
          if (
            !input ||
            !isInRange(input.sensitivity, MIN_SENSITIVITY, MAX_SENSITIVITY) ||
            !isInRange(input.smoothing, MIN_SMOOTHING, MAX_SMOOTHING)
          ) {
            throw new Error('Invalid response settings');
          }
          controls.apply(input);
          return controls.read();
        },
      }),
    ).catch(() => {});
  } catch {
    // Tool registration is best-effort; the page works without it.
  }
}
