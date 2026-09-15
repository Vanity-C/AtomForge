// The container supervisor restarts the process if a browser/cleanup never settles.
export function jobWatchdog(onTimeout, timeoutMs=90000) {
  const timer=setTimeout(onTimeout,timeoutMs);
  timer.unref();
  return ()=>clearTimeout(timer);
}
