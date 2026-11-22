import { SOURCES } from '../../../docs/engine.js';
import {
  compareLogistics, fetchFxRates, FX_SOURCE, LOGISTICS_MODES, LOGISTICS_SCOPES, normalizeQuoteComparison,
} from '../../../docs/logistics.js';
import { buildRfqDraft, buildShipmentWorkflow, inferWorkflowScenario } from '../../../docs/shipment-workflow.js';
import { AGENT_LIMITS } from '../application/agent-service.mjs';
import { limitResponseBody } from './response-body.mjs';

const noArguments = { type: 'object', properties: {}, required: [], additionalProperties: false };
const { title, url } = SOURCES.find(source => source.id === 'incoterms');
const termsSource = { title, url, kind: 'reference' };
const fxEndpoint = new URL(FX_SOURCE.endpoint);
const encoder = new TextEncoder();

function evaluationDate(date) {
  const utc = new Date().toISOString().slice(0, 10);
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return utc;
  const time = Date.parse(date);
  return Number.isFinite(time) && Math.abs(time - Date.parse(utc)) <= 86_400_000 &&
    new Date(time).toISOString().slice(0, 10) === date ? date : utc;
}

function workflowInput({ question, shipment, logistics }) {
  const details = logistics?.workflow || {};
  const input = inferWorkflowScenario(question, shipment, details) || { shipment, details };
  return { ...input, today: evaluationDate(logistics?.date) };
}

function describeOption(option) {
  return {
    id: option.id, label: option.label.slice(0, 40), mode: LOGISTICS_MODES[option.mode], scope: LOGISTICS_SCOPES[option.scope],
    currency: option.currency, freight: option.freight, extras: option.extras,
    ...(option.fees && { fees: option.fees, feesComplete: option.feesComplete }),
    knownSubtotal: option.knownCost, completeQuotedTotal: option.costTotal,
    convertedQuotedTotal: option.convertedTotal, fxDate: option.fxDate, transitDays: option.transitDays,
    expiryStatus: option.expiryStatus, deliveryStatus: option.deliveryStatus,
    handoffs: option.handoffs, confirmedBackup: option.backup, risks: option.flags.map(flag => flag.code),
  };
}

async function comparisonResult(context, signal, fetchImpl) {
  const comparison = normalizeQuoteComparison(context.logistics?.comparison);
  if (!comparison) {
    return {
      status: 'needs_input', sources: [],
      data: { note: '需在「运输方案与风险」填入共同起点、终点、货量和至少两个非演示方案。没有实时航运或承运商报价。' },
    };
  }

  const currencies = [...new Set(comparison.quotes.map(quote => quote.currency))];
  let fx;
  let fxUnavailable = false;
  if (currencies.some(currency => currency !== comparison.baseCurrency)) {
    const fxSignal = AbortSignal.any([signal, AbortSignal.timeout(5_000)].filter(Boolean));
    try {
      fx = await fetchFxRates(comparison.baseCurrency, currencies, {
        signal: fxSignal,
        fetchImpl: async (url, options) => {
          const target = new URL(url);
          if (target.origin !== fxEndpoint.origin || target.pathname !== fxEndpoint.pathname) {
            throw new Error('Unknown FX endpoint');
          }
          const response = await fetchImpl(url, { ...options, method: 'GET', redirect: 'manual' });
          return limitResponseBody(response, 64 * 1024);
        },
      });
    } catch {
      signal?.throwIfAborted();
      fxUnavailable = true;
    }
  }
  const today = evaluationDate(context.logistics?.date);
  const result = compareLogistics({ ...comparison, shipment: { ...context.shipment, ...comparison.shipment }, fx, today });
  const hasFx = result.options.some(option => option.fxDate);
  const response = {
    status: 'ok',
    data: {
      scope: '按用户录入的承运商报价比较。折算采用参考汇率，仅比较同服务范围内符合条件的方案。已知费用小计不是到岸总成本，关税、VAT 和未知费用需另核。',
      basis: comparison.shipment, currency: result.baseCurrency, deliveryLimitDays: result.deliveryLimitDays,
      cheapest: result.cheapest?.id ?? null, fastest: result.fastest?.id ?? null,
      cheapestWithinLimit: result.cheapestWithinLimit?.id ?? null,
      notices: result.flags.map(flag => flag.text), options: result.options.map(describeOption),
      ...(fxUnavailable && { fxNote: '参考汇率暂不可用，缺少汇率的方案保留原币金额。' }),
    },
    sources: hasFx ? [{ title: FX_SOURCE.name, url: FX_SOURCE.url, kind: 'lookup', retrievedAt: new Date().toISOString() }] : [],
  };
  if (encoder.encode(JSON.stringify(response)).byteLength > AGENT_LIMITS.toolResultBytes) {
    response.data.options = response.data.options.map(({ fees, ...summary }) => summary);
    response.data.notices.push('报价明细较多，本次工具输出保留各方案已知小计与完整报价。单项费用可在比价表查看。');
  }
  return response;
}

export function createLogisticsTools({ fetchImpl = globalThis.fetch } = {}) {
  return [
    {
      name: 'plan_shipment_workflow',
      description: '生成运输流程节点、Incoterms 风险和费用责任、单证清单、已录入截止日和已知异常的处理建议。',
      parameters: noArguments,
      execute(_args, context) {
        const data = buildShipmentWorkflow(workflowInput(context));
        return { status: 'ok', data, sources: [termsSource] };
      },
    },
    {
      name: 'compare_transport_quotes',
      description: '按工作台已录入的实际报价比较运输方式的成本、时间、费用完整性和风险。禁止根据市场常识补填价格。',
      parameters: noArguments,
      execute: (_args, context, signal) => comparisonResult(context, signal, fetchImpl),
    },
    {
      name: 'draft_freight_inquiry',
      description: '使用实际已知路线、货量和交货要求生成英文询价邮件草稿。未知字段保留待补，不发送邮件。',
      parameters: noArguments,
      execute(_args, context) {
        return {
          status: 'ok', sources: [],
          data: { draft: buildRfqDraft(workflowInput(context)) },
        };
      },
    },
  ];
}
