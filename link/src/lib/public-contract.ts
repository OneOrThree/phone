import { createHash, randomInt } from 'node:crypto';
import { landingTemplate } from './landing-template';
import { baseUrl, optional, required } from './env';

const bots = ['kakaotalk-scrap', 'facebookexternalhit', 'slackbot', 'twitterbot',
  'whatsapp', 'yeti', 'embedly', 'pinterest', 'skypeuripreview', 'bot', 'crawler', 'spider'];

export function isBot(ua: string | null): boolean {
  return !ua?.trim() || bots.some(marker => ua.toLowerCase().includes(marker));
}

export function classifyOs(ua: string | null): string {
  const value = (ua ?? '').toLowerCase();
  if (/iphone|ipad|ipod/.test(value) || (value.includes('macintosh') && value.includes('mobile'))) return 'ios';
  return value.includes('android') ? 'android' : 'other';
}

export function hashIp(ip: string): string {
  return createHash('sha256').update(ip + required('LINK_IP_SALT'), 'utf8').digest('hex');
}

export function generateSlug(): string {
  const alphabet = '23456789abcdefghjkmnpqrstuvwxyz';
  return Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join('');
}

export function escapeHtml(value: string): string {
  const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return value.replace(/[&<>"']/g, char => entities[char]!);
}

export function landing(link?: { group_name: string; inviter_name: string | null; group_id: string; slug: string }): string {
  const group = escapeHtml(link?.group_name ?? '그로모 그룹');
  const graphemes = [...new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(link?.inviter_name?.trim() ?? '')];
  const inviter = escapeHtml(graphemes.slice(0, 20).map(part => part.segment).join('')) + (graphemes.length > 20 ? '…' : '');
  const store = optional('LINK_STORE_IOS_URL') ?? '';
  const usable = /^https?:\/\//i.test(store) && !/\/id0+(?=[/?#]|$)/.test(store);
  const invitation = `gromo 그룹 「${group}」에 초대했어요`;
  const fields: Record<string, string> = {
    groupName: group, inviterName: inviter, hasInviter: String(!!inviter),
    pageTitle: inviter ? `${inviter}님이 ${invitation}` : invitation,
    schemeUrl: link ? escapeHtml(`gromo://join?g=${link.group_id}&s=${link.slug}`) : '',
    storeUrl: usable ? escapeHtml(store) : '', storeState: usable ? 'ready' : 'unset',
    ogImageUrl: escapeHtml(`${baseUrl()}/link/og-invite-v2.png`), expired: String(!link),
  };
  // 사용자 입력 안에 있는 다른 placeholder는 다시 치환하지 않는다.
  return landingTemplate.replace(/\{\{(\w+)}}/g, (_, key: string) => fields[key] ?? '');
}

export const aasa = { applinks: { apps: [], details: [{
  appIDs: ['P6Z68QUK9M.com.oneorthree.gromo'], components: [{ '/': '/l/*' }],
}] } };
