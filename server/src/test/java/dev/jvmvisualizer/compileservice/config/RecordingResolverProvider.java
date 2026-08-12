package dev.jvmvisualizer.compileservice.config;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.net.spi.InetAddressResolver;
import java.net.spi.InetAddressResolverProvider;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.stream.Stream;

public final class RecordingResolverProvider extends InetAddressResolverProvider {

    private static final List<String> NAMES_LOOKED_UP = new CopyOnWriteArrayList<>();

    static void reset() {
        NAMES_LOOKED_UP.clear();
    }

    static List<String> namesLookedUp() {
        return List.copyOf(NAMES_LOOKED_UP);
    }

    @Override
    public InetAddressResolver get(Configuration configuration) {
        InetAddressResolver builtin = configuration.builtinResolver();
        return new InetAddressResolver() {

            @Override
            public Stream<InetAddress> lookupByName(String host, LookupPolicy policy) throws UnknownHostException {
                NAMES_LOOKED_UP.add(host);
                return builtin.lookupByName(host, policy);
            }

            @Override
            public String lookupByAddress(byte[] address) throws UnknownHostException {
                return builtin.lookupByAddress(address);
            }
        };
    }

    @Override
    public String name() {
        return "recording";
    }
}
