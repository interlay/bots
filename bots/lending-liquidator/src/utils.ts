import type { AnyTuple } from "@polkadot/types/types";
import { ApiPromise } from "@polkadot/api";
import { AugmentedEvent, ApiTypes } from "@polkadot/api/types";
import { EventRecord } from "@polkadot/types/interfaces/system";

export async function waitForEvent<T extends AnyTuple>(
    api: ApiPromise,
    event: AugmentedEvent<ApiTypes, T>,
    timeoutMs: number
): Promise<boolean> {
    // Use this function with a timeout.
    // Unless the awaited event occurs, this Promise will never resolve.
    let timeoutHandle: NodeJS.Timeout;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => reject(), timeoutMs);
    });

    await Promise.race([
        new Promise<void>((resolve, _reject) => {
            api.query.system.events((eventsVec) => {
                const events = eventsVec.toArray();
                if (doesArrayContainEvent(events, event)) {
                    resolve();
                }
            });
        }),
        timeoutPromise,
    ]).then((_) => {
        clearTimeout(timeoutHandle);
    });

    return true;
}

function doesArrayContainEvent<T extends AnyTuple>(
    events: EventRecord[],
    eventType: AugmentedEvent<ApiTypes, T>
): boolean {
    for (const { event } of events) {
        if (eventType.is(event)) {
            return true;
        }
    }
    return false;
}