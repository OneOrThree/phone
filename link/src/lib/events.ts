import { fail, object, text, uuid, version } from './errors';
import { confirm, joined, revoke, updateMembershipDisplay, updateSnapshot, withdraw } from './links';

/** Data relay의 고정 경로. 외부 payload로 목적지 URL을 조합하지 않는다. */
export async function ingestEvent(input: unknown) {
  const event = object(input), params = object(event.params), id = text(event.eventId, 200);
  if (event.schemaVersion !== 1) fail(422, 'UNSUPPORTED_SCHEMA_VERSION');
  const userId = uuid(event.userId), sequence = version(event.version);
  switch (event.type) {
    case 'link.revoked': return revoke(params, id, event);
    case 'link.claimConfirmed': return confirm(uuid(params.claimId), params, id, event);
    case 'link.joined': return joined(text(params.slug, 12), { ...params, userId, eventId: id, occurredAt: event.occurredAt }, id, event);
    case 'group.closed': return updateSnapshot('groups', uuid(params.groupId), { version: sequence }, id, true, event);
    case 'group.renamed': return updateMembershipDisplay(params, id, 'group', event);
    case 'user.displayNameChanged': return updateMembershipDisplay(params, id, 'inviter', event);
    case 'user.withdrawn': return withdraw(userId, { transitionSeq: sequence }, id, event);
    default: fail(422, 'UNSUPPORTED_EVENT_TYPE');
  }
}
