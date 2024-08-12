import argparse
import math
import sys
import time

import numpy as np 
import sounddevice as sd
from scipy.fft import rfft, rfftfreq

from python_utils import Zome, transform_to_byte_str


parser = argparse.ArgumentParser()

parser.add_argument("model_file", type=str, help="the zome's model file", default='zome_model.json')

args = parser.parse_args()

# Set constants
sample_rate = 44100  # Standard sample rate
chunk_size = 1102  # Size of each audio chunk
num_chunks = 50  # Number of chunks to display at a time

# Prepare arrays
data = np.zeros((num_chunks, chunk_size))
freqs = rfftfreq(chunk_size, 1 / sample_rate)
ffts = np.zeros((num_chunks, len(freqs)))

# Set initial EMA value and smoothing factor
ema_volume = 10
alpha = 0.1

 # Callback function
def callback(indata, frames, time, status):
    global ffts, ema_volume
    # Get the volume of the current chunk
    volume = np.linalg.norm(indata) * 10
    # Update the EMA of the volume
    ema_volume = volume * alpha + ema_volume * (1 - alpha)
    #print("Current volume: ", volume)
    #print("EMA volume: ", ema_volume)
    # Perform a Fourier transform on the data
    fft_data = np.abs(rfft(indata[:, 0]))
    # Shift the data in the array and add the new data
    ffts[:-1] = ffts[1:]
    ffts[-1] = fft_data * volume

def hls_to_rgb(h, l, s):
    """ Vectorized implementation of colorsys.hls_to_rgb. """
    
    def hue_to_rgb(p, q, t):
        t = np.where(t < 0, t + 1, t)
        t = np.where(t > 1, t - 1, t)
        return np.where(t < 1/6, p + (q - p) * 6 * t, 
                        np.where(t < 1/2, q, 
                                 np.where(t < 2/3, p + (q - p) * (2/3 - t) * 6, p)))
    
    h = np.asarray(h)
    l = np.asarray(l)
    s = np.asarray(s)
    
    ones = np.ones_like(h)
    
    p = np.where(l <= 0.5, l * (ones + s), l + s - l * s)
    q = 2 * l - p
    r = hue_to_rgb(q, p, h + ones / 3)
    g = hue_to_rgb(q, p, h)
    b = hue_to_rgb(q, p, h - ones / 3)
    
    return np.stack([r, g, b], axis=-1)

def sound_reactive(zome):
    frame_id = 0
    frame_delta_s = 1.0 / zome.fps
    scheduled_send_time_s = time.time()
    num_fft_items = ffts[0].shape[0]
    hue_offset = 0.0
    rgba_values = np.zeros((zome.num_pixels, 4)).astype(int)
    # Upward pixel movement effect
    pixel_indices = np.arange(len(zome.pixels))[::-1]

    try:
        # Open connection to audio device and start the stream
        stream = sd.InputStream(callback=callback, channels=1, samplerate=sample_rate, blocksize=chunk_size)
        stream.start()

        while True:
            if time.time() > scheduled_send_time_s - 0.002:
                fft_index_values = (pixel_indices + int(round(frame_id*0.25))) % num_fft_items

                # Try to maintain a good brightness level. When the average loudness is low, increase the brighness
                # so that the pattern is visible.
                intensities = np.clip(ffts[-1][fft_index_values] / math.pow(ema_volume, 1.3), 0, 1)

                # Display hues that are mostly close together, and also change hue over time.
                hues = (np.power((fft_index_values / num_fft_items), 2) * 0.5 + hue_offset) % 1

                rgb_values = hls_to_rgb(hues, intensities, 1.0)
                rgb_values *= 255
                rgb_values = rgb_values.astype(int)
                rgba_values[:, :3] = rgb_values
                rgba_values[:, 3] = 255

                msg = transform_to_byte_str(frame_id, rgba_values)
                sys.stdout.buffer.write(msg)

                frame_id += 1
                hue_offset += 0.001
                scheduled_send_time_s += frame_delta_s
            else:
                time.sleep((scheduled_send_time_s - 0.001) - time.time())

    except KeyboardInterrupt:
        print("Stopped listening.")
    finally:
        stream.stop()
        stream.close()


if __name__ == "__main__":
    sys.stderr.write(f"loading file {args.model_file}\n")
    zome = Zome(args.model_file)
    sound_reactive(zome=zome)

