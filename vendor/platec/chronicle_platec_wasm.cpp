// Chronicle's WASM ABI for the LGPL-licensed Platec library; LGPL-3.0-or-later.
// Keep fixed-width seed bits and separate module instances for individual jobs.
#include "src/platecapi.hpp"

extern "C" {
void* chronicle_platec_create(uint32_t seed, uint32_t width, uint32_t height,
                             float sea_fraction, uint32_t erosion_period,
                             float folding_ratio, uint32_t overlap_absolute,
                             float overlap_relative, uint32_t cycles,
                             uint32_t plates) {
    return platec_api_create(static_cast<long>(seed), width, height, sea_fraction,
                            erosion_period, folding_ratio, overlap_absolute,
                            overlap_relative, cycles, plates);
}
void chronicle_platec_destroy(void* simulation) {
    platec_api_destroy(simulation);
}
float* chronicle_platec_heightmap(void* simulation) {
    return platec_api_get_heightmap(simulation);
}
uint32_t chronicle_platec_finished(void* simulation) {
    return platec_api_is_finished(simulation);
}
void chronicle_platec_step(void* simulation) {
    platec_api_step(simulation);
}
}
