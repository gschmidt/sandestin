import argparse
import sys
import time
import colorsys

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

 # Callback function
def callback(indata, frames, time, status):
    global ffts, last_time
    # Get the volume of the current chunk
    volume = np.linalg.norm(indata) * 10
    # Perform a Fourier transform on the data
    fft_data = np.abs(rfft(indata[:, 0]))
    # Shift the data in the array and add the new data
    ffts[:-1] = ffts[1:]
    ffts[-1] = fft_data * volume

def sound_reactive(zome):
    frame_id = 0
    last_sent_time_s = time.time()
    frame_delta_s = 1.0 / zome.fps
    scheduled_send_time_s = time.time()
    num_fft_items = ffts[0].shape[0]
    hue_offset = 0.0

    # Open connection to audio device and start the stream
    stream = sd.InputStream(callback=callback, channels=1, samplerate=sample_rate, blocksize=chunk_size)
    stream.start()
    try:
        rgba_values = np.zeros((zome.num_pixels, 4)).astype(int) #initialize with all zeros 
        while True:
            if time.time() > scheduled_send_time_s - 0.002:
                for index in range(len(zome.pixels)):
                    i = (index + frame_id) % len(zome.pixels)
                    fft_index = i % num_fft_items
                    intensity = min(1.0, (ffts[-1][fft_index] / 100))
                    hue = (((i % num_fft_items) / num_fft_items) + hue_offset) % 1.0
                    r,g,b, = colorsys.hls_to_rgb(hue, intensity, 1.0)
                    rgba_values[i][0] = r * 255
                    rgba_values[i][1] = g * 255
                    rgba_values[i][2] = b * 255
                    rgba_values[i][3] = 255
                msg = transform_to_byte_str(frame_id, rgba_values)
                sys.stdout.buffer.write(msg)
                frame_id += 1
                hue_offset += 0.01
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
