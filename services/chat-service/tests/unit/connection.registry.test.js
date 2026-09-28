import { describe, it, expect, beforeEach } from 'vitest';
import * as registry from '../../src/websocket/connection.registry.js';

describe('Connection Registry - Detailed', () => {

  it('addUserConnection: should map userId to a mock websocket connection', () => {
    const ws = { id: 1 };
    registry.addUserConnection('user-1', ws);
    const conns = registry.getUserConnections('user-1');
    expect(conns.has(ws)).toBe(true);
  });

  it('removeUserConnection: should properly clean up websocket references', () => {
    const ws = { id: 1 };
    registry.addUserConnection('user-2', ws);
    registry.removeUserConnection('user-2', ws);
    const conns = registry.getUserConnections('user-2');
    expect(conns.size).toBe(0);
  });

  it('getUserConnections: should return all websockets for a user', () => {
    const ws1 = { id: 1 };
    const ws2 = { id: 2 };
    registry.addUserConnection('user-3', ws1);
    registry.addUserConnection('user-3', ws2);
    
    const conns = registry.getUserConnections('user-3');
    expect(conns.size).toBe(2);
    expect(conns.has(ws1)).toBe(true);
    expect(conns.has(ws2)).toBe(true);
  });
});
