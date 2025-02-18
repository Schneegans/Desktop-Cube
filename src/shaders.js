// Based on https://github.com/G-dH/gnome-colorblind-filters/blob/main/shaders.js

'use strict';

import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';

export const CorsorBeam = GObject.registerClass(
    class CorsorBeam extends Clutter.ShaderEffect {
        _init(res_x, res_y) {
            super._init();

            this._res_x = res_x;
            this._res_y = res_y;

            this._rot_x = 0.0;
            this._rot_y = 0.0;
            this._rot_z = 0.0;

            this._pointer_pos_x = 0;
            this._pointer_pos_y = this._res_y - 0;

            this._no_beam = 0;

            this.queue_repaint();

            this._source = ShaderLib.getCorsorBeam();
            this.set_shader_source(this._source);
        }

        updateEffect(properties) {
            this._rot_x = properties.rot_x;
            this._rot_y = properties.rot_y;
            this._rot_z = properties.rot_z;
            this._pointer_pos_x = properties.pointer_pos_x;
            this._pointer_pos_y = this._res_y - properties.pointer_pos_y;
            this._no_beam = properties.no_beam ? 1 : 0;
            this.queue_repaint();
        }

        vfunc_get_static_shader_source() {
            return this._source;
        }

        vfunc_paint_target(...args) {
            this.set_uniform_value('tex', 0);
            this.set_uniform_value('rot_x', this._rot_x);
            this.set_uniform_value('rot_y', this._rot_y);
            this.set_uniform_value('rot_z', this._rot_z);
            this.set_uniform_value('pointer_pos_x', this._pointer_pos_x);
            this.set_uniform_value('pointer_pos_y', this._pointer_pos_y);
            this.set_uniform_value('res_x', this._res_x);
            this.set_uniform_value('res_y', this._res_y);
            this.set_uniform_value('no_beam', this._no_beam);
            super.vfunc_paint_target(...args);
        }
    });

export const ShaderLib = class {
    static getCorsorBeam() {
        return `
            uniform sampler2D tex;

            uniform float rot_x;
            uniform float rot_y;
            uniform float rot_z;

            uniform int pointer_pos_x;
            uniform int pointer_pos_y;

            uniform int res_x;
            uniform int res_y;

            uniform int no_beam;

            // draw line segment from A to B
            float segment(vec2 P, vec2 A, vec2 B, float r) 
            {
                vec2 g = B - A;
                vec2 h = P - A;
                float d = length(h - g * clamp(dot(g, h) / dot(g,g), 0.0, 1.0));
                return smoothstep(r, 0.5*r, d);
            }

            const vec3 lineColor = vec3(0.95,0.95,0.10);

            void main() {
                vec4 c = texture2D(tex, cogl_tex_coord_in[0].st);

                vec2 iMouse = vec2(float(pointer_pos_x), float(pointer_pos_y));
                vec3 iRot = vec3(rot_y, -rot_x, rot_z);
                vec2 iResolution = vec2(res_x, res_y);

                vec2 uv = (gl_FragCoord.xy * 2.0 - iResolution.xy) / iResolution.y;
                vec2 mo = (iMouse.xy * 2.0 - iResolution.xy) / iResolution.y;
                vec2 mo_hmd = mo + (iRot.xy * 0.032);
                float thickness = 0.001 + 0.001 / distance(uv, mo);

                vec2 point_from = mo;
                vec2 point_to;

                if (no_beam != 0) {
                    point_to = mo;
                } else {
                    point_to = mo_hmd;
                }

                float intensity = segment(uv, point_to, point_from, thickness) * (distance(point_from, uv) + 0.1);
                
                c.rgb = mix(c.rgb, lineColor, intensity);
                
                cogl_color_out = c;
            };
        `;
    }
}
