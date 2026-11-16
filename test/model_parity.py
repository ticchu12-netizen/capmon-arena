"""Compares the plain-JS model (outputs recorded by collect_obs.js) with onnxruntime
running the original ONNX file. Exposes the raw logits of the ONNX graph as an extra
output so the comparison is numeric, not only "same pick"."""
import json, os, sys
import numpy as np, onnx, onnxruntime as ort

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(ROOT, 'test', 'out')
LOGITS = '/_discrete_distribution/branches.0/Gemm_output_0'

m = onnx.load(os.path.join(ROOT, 'ref', 'brain', 'CapmonAI-57999998.onnx'))
vi = onnx.helper.make_tensor_value_info(LOGITS, onnx.TensorProto.FLOAT, None)
m.graph.output.append(vi)
sess = ort.InferenceSession(m.SerializeToString(), providers=['CPUExecutionProvider'])

obs = np.fromfile(os.path.join(OUT, 'obs.f32'), dtype=np.float32).reshape(-1, 192)
masks = np.fromfile(os.path.join(OUT, 'masks.f32'), dtype=np.float32).reshape(-1, 4)
js_logits = np.fromfile(os.path.join(OUT, 'logits.f64'), dtype=np.float64).reshape(-1, 4)
js_act = np.fromfile(os.path.join(OUT, 'actions.u8'), dtype=np.uint8)
n = obs.shape[0]
stress = int(sys.argv[1]) if len(sys.argv) > 1 else 4000

ort_act = np.zeros(n, dtype=np.int64)
ort_logits = np.zeros((n, 4), dtype=np.float64)
zero = np.zeros((1, 1, 512), dtype=np.float32)
for i in range(n):  # one row at a time, exactly as the server calls it
    r = sess.run(['deterministic_discrete_actions', LOGITS], {'obs_0': obs[i:i+1], 'action_masks': masks[i:i+1], 'recurrent_in': zero})
    ort_act[i] = int(np.asarray(r[0]).reshape(-1)[0])
    ort_logits[i] = np.asarray(r[1], dtype=np.float64).reshape(-1)

def report(name, sl):
    a, b = js_act[sl].astype(np.int64), ort_act[sl]
    d = np.abs(js_logits[sl] - ort_logits[sl])
    ml = np.where(masks[sl] > 0, ort_logits[sl], -np.inf)
    srt = np.sort(ml, axis=1)
    gap = srt[:, -1] - srt[:, -2]
    gap = gap[np.isfinite(gap)]
    mism = np.nonzero(a != b)[0]
    out = {
        'rows': int(len(a)),
        'same_pick': int((a == b).sum()),
        'different_pick': int(len(mism)),
        'max_logit_difference': float(d.max()),
        'mean_logit_difference': float(d.mean()),
        'smallest_gap_between_top_two': float(gap.min()) if len(gap) else None,
        'gaps_under_1e-3': int((gap < 1e-3).sum()),
        'pick_counts': np.bincount(b, minlength=4).tolist(),
        'logit_range': [float(ort_logits[sl].min()), float(ort_logits[sl].max())],
    }
    if len(mism):
        out['first_mismatches'] = [{'row': int(i), 'js': int(a[i]), 'ort': int(b[i]), 'mask': masks[sl][i].tolist(), 'ort_logits': ort_logits[sl][i].tolist(), 'js_logits': js_logits[sl][i].tolist()} for i in mism[:5]]
    print(name, json.dumps(out, indent=1))
    return out

game = report('GAME DECISIONS', slice(0, n - stress))
st = report('STRESS ROWS', slice(n - stress, n))
json.dump({'game': game, 'stress': st}, open(os.path.join(OUT, 'model_parity.json'), 'w'), indent=1)
ok = game['different_pick'] == 0 and st['different_pick'] == 0
print('RESULT:', 'PASS' if ok else 'FAIL')
sys.exit(0 if ok else 1)
