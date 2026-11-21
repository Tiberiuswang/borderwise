const MAX_ARGUMENT_CHARS = 2_000;

function matchesParameter(value, rule) {
  if (typeof value !== rule.type) return false;
  if (rule.enum && !rule.enum.includes(value)) return false;
  if (rule.minLength !== undefined && value.length < rule.minLength) return false;
  if (rule.maxLength !== undefined && value.length > rule.maxLength) return false;
  if (rule.pattern && !new RegExp(rule.pattern).test(value)) return false;
  return true;
}

export function reviewToolCall(call, tools, context) {
  const tool = tools.get(call.name);
  if (!tool) return { allowed: false, reason: 'unknown_tool' };

  let args;
  try {
    if (typeof call.arguments !== 'string' || call.arguments.length > MAX_ARGUMENT_CHARS) {
      return { allowed: false, reason: 'invalid_arguments' };
    }
    args = JSON.parse(call.arguments);
  } catch {
    return { allowed: false, reason: 'invalid_arguments' };
  }

  const { properties = {}, required = [] } = tool.parameters;
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
      required.some(key => !Object.hasOwn(args, key)) ||
      Object.entries(args).some(([key, value]) => !Object.hasOwn(properties, key) ||
        !matchesParameter(value, properties[key]))) {
    return { allowed: false, reason: 'invalid_arguments' };
  }

  if (tool.review && !tool.review(args, context)) {
    return { allowed: false, reason: 'outside_user_context' };
  }
  return { allowed: true, tool, args };
}

export function modelTools(tools) {
  return tools.map(({ name, description, parameters }) => ({
    type: 'function',
    function: { name, description, parameters },
  }));
}
