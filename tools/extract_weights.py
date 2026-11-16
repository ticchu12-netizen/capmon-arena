#!/usr/bin/env python3
"""
Extracts the Capmon battle model's weights from the ONNX file into the flat
binary the browser engine loads (docs/assets/brain.bin).

The network (ML-Agents PPO export) is:
  normalize(192) -> Dense 512 + swish -> Dense 512 + swish -> Dense 512 + swish
  -> LSTM(256) run for one step from a zero state -> Dense 4 (move logits)

Because the recurrent input is always zero in the game (AIBrain feeds zeros and
never carries memory), the LSTM reduces to: h = o * tanh(i * g). The recurrent
weight matrix and the forget gate therefore never influence the output and are
not shipped.

Layout of brain.bin (little endian):
  bytes 0..3   magic "CAPB"
  bytes 4..7   uint32 version (1)
  bytes 8..11  uint32 number of float32 values that follow
  bytes 12..15 reserved (0)
  then float32 values in this order:
    norm_mean[192], norm_div[192],
    W0[512*192], b0[512], W1[512*512], b1[512], W2[512*512], b2[512],
    lstm_Wi[256*512], lstm_Wo[256*512], lstm_Wg[256*512],
    lstm_bi[256], lstm_bo[256], lstm_bg[256],        (input bias + recurrent bias, summed in float64 then stored as float32)
    head_W[4*256], head_b[4]

Usage: extract_weights.py <model.onnx> <out.bin> <manifest.json>
"""
import sys, json, hashlib, struct
import numpy as np, onnx
from onnx import numpy_helper

src, out_bin, out_manifest = sys.argv[1], sys.argv[2], sys.argv[3]
m = onnx.load(src)
init = {t.name: numpy_helper.to_array(t) for t in m.graph.initializer}
nodes = {n.output[0]: n for n in m.graph.node}

def need(name, shape):
    a = init[name]
    assert tuple(a.shape) == shape, (name, a.shape, shape)
    assert a.dtype == np.float32, (name, a.dtype)
    return a

mean = need('network_body.observation_encoder.processors.0.normalizer.running_mean', (192,))
div  = need('onnx::Div_97', (192,))
W0 = need('network_body._body_endoder.seq_layers.0.weight', (512, 192)); b0 = need('network_body._body_endoder.seq_layers.0.bias', (512,))
W1 = need('network_body._body_endoder.seq_layers.2.weight', (512, 512)); b1 = need('network_body._body_endoder.seq_layers.2.bias', (512,))
W2 = need('network_body._body_endoder.seq_layers.4.weight', (512, 512)); b2 = need('network_body._body_endoder.seq_layers.4.bias', (512,))
LW = need('onnx::LSTM_115', (1, 1024, 512))[0]
LR = need('onnx::LSTM_116', (1, 1024, 256))[0]
LB = need('onnx::LSTM_117', (1, 2048))[0]
HW = need('action_model._discrete_distribution.branches.0.weight', (4, 256)); hb = need('action_model._discrete_distribution.branches.0.bias', (4,))

# --- structural checks: the reduction above is only valid if these hold ---
ops = [n.op_type for n in m.graph.node]
assert ops.count('LSTM') == 1 and ops.count('Gemm') == 4, ops
lstm = [n for n in m.graph.node if n.op_type == 'LSTM'][0]
attrs = {a.name: a for a in lstm.attribute}
assert set(attrs) == {'hidden_size'} and attrs['hidden_size'].i == 256, attrs.keys()   # default sigmoid/tanh/tanh, forward, no clip
assert lstm.input[4] == '' and len(lstm.input) == 7, list(lstm.input)                  # no sequence_lens, no peepholes
clip = [n for n in m.graph.node if n.op_type == 'Clip'][0]
ca = {a.name: a.f for a in clip.attribute}
assert ca == {'max': 5.0, 'min': -5.0}, ca
for g in [n for n in m.graph.node if n.op_type == 'Gemm']:
    ga = {a.name: (a.f if a.type == 1 else a.i) for a in g.attribute}
    assert ga == {'alpha': 1.0, 'beta': 1.0, 'transB': 1}, ga
# mask constants: logits*mask - (mask*c0 + c1)*c2 ; expect c0=-1, c1=1, c2=1e8
consts = {}
for n in m.graph.node:
    if n.op_type == 'Constant' and '_discrete_distribution' in n.output[0]:
        consts[n.output[0]] = numpy_helper.to_array(n.attribute[0].t)
c0 = float(consts['/_discrete_distribution/Constant_output_0']); c1 = float(consts['/_discrete_distribution/Constant_1_output_0']); c2 = float(consts['/_discrete_distribution/Constant_2_output_0'])
assert (c0, c1) == (-1.0, 1.0) and c2 >= 1e6, (c0, c1, c2)

H = 256
Wi, Wo, Wf, Wg = LW[0:H], LW[H:2*H], LW[2*H:3*H], LW[3*H:4*H]          # ONNX gate order: i, o, f, c
Wb, Rb = LB[:4*H].astype(np.float64), LB[4*H:].astype(np.float64)
bi = (Wb[0:H] + Rb[0:H]).astype(np.float32)
bo = (Wb[H:2*H] + Rb[H:2*H]).astype(np.float32)
bg = (Wb[3*H:4*H] + Rb[3*H:4*H]).astype(np.float32)

parts = [mean, div, W0, b0, W1, b1, W2, b2, Wi, Wo, Wg, bi, bo, bg, HW, hb]
flat = np.concatenate([p.astype('<f4').ravel() for p in parts])
header = b'CAPB' + struct.pack('<III', 1, flat.size, 0)
blob = header + flat.tobytes()
open(out_bin, 'wb').write(blob)

manifest = {
    'file': 'brain.bin', 'version': 1, 'floats': int(flat.size), 'bytes': len(blob),
    'sha256': hashlib.sha256(blob).hexdigest(),
    'source': {'file': 'capbot-server/brain/CapmonAI-57999998.onnx', 'sha256': hashlib.sha256(open(src, 'rb').read()).hexdigest(),
               'producer': f'{m.producer_name} {m.producer_version}', 'opset': int(m.opset_import[0].version)},
    'mask_constants': {'c0': c0, 'c1': c1, 'c2': c2},
    'dropped': 'LSTM recurrent weights and forget gate (no effect with a zero initial state)',
}
json.dump(manifest, open(out_manifest, 'w'), indent=2)
print(json.dumps(manifest, indent=2))
