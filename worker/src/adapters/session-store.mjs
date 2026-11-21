// Chat requests carry a validated conversation snapshot. Tool messages live in
// this request's store and are never accepted from the browser.
export function createRequestSessionStore(initialMessages) {
  const messages = [...initialMessages];
  return {
    append(message) { messages.push(message); },
    read() { return [...messages]; },
  };
}
