import { useState } from 'react';
import { getToken, setToken } from '../api/github';

// PAT 1회 입력 → localStorage. fine-grained PAT 권장 권한: Actions(rw)·Contents(r).
export function PatModal({ onSaved }: { onSaved: () => void }) {
  const [value, setValue] = useState(getToken());
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2>GitHub PAT 등록</h2>
        <p className="muted">
          fine-grained PAT — 권한: <b>Actions(Read and write)</b>, <b>Contents(Read-only)</b>.
          브라우저 localStorage 에만 저장되며 서버로 전송되지 않습니다.
        </p>
        <input
          type="password"
          placeholder="github_pat_…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button
          disabled={!value.trim()}
          onClick={() => {
            setToken(value);
            onSaved();
          }}
        >
          저장
        </button>
      </div>
    </div>
  );
}
