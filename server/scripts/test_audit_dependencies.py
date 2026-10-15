import importlib.util
import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch


spec = importlib.util.spec_from_file_location('audit', Path(__file__).with_name('audit-dependencies.py'))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class DependencyAuditTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.inventory = Path(self.directory.name) / 'dependencies.txt'
        self.inventory.write_text('   org.example:library:jar:1.2.3:compile -- module example\n')
        self.output = io.StringIO()
        self.errors = io.StringIO()
        self.enterContext(redirect_stdout(self.output))
        self.enterContext(redirect_stderr(self.errors))

    def response(self, results):
        return io.BytesIO(json.dumps({'results': results}).encode())

    def test_reports_a_clean_inventory(self):
        with patch.object(audit.urllib.request, 'urlopen', return_value=self.response([{}])) as request:
            audit.audit(self.inventory)
        query = json.loads(request.call_args.args[0].data)['queries'][0]
        self.assertEqual(query['package'], {'ecosystem': 'Maven', 'name': 'org.example:library'})
        self.assertEqual(query['version'], '1.2.3')
        self.assertIn('Checked 1 Maven runtime dependencies', self.output.getvalue())

    def test_does_not_skip_vulnerabilities_on_subsequent_pages(self):
        responses = [self.response([{'next_page_token': 'page-two'}]),
                     self.response([{'vulns': [{'id': 'GHSA-example'}]}])]
        with patch.object(audit.urllib.request, 'urlopen', side_effect=responses) as request:
            with self.assertRaisesRegex(ValueError, 'found 1 dependency/advisory matches'):
                audit.audit(self.inventory)
        second = json.loads(request.call_args.args[0].data)['queries'][0]
        self.assertEqual(second['page_token'], 'page-two')
        self.assertIn('org.example:library:1.2.3', self.errors.getvalue())
        self.assertIn('https://osv.dev/vulnerability/GHSA-example', self.errors.getvalue())

    def test_rejects_an_incomplete_result(self):
        with patch.object(audit.urllib.request, 'urlopen', return_value=self.response([])):
            with self.assertRaisesRegex(ValueError, 'incomplete dependency scan'):
                audit.audit(self.inventory)

    def test_rejects_an_empty_inventory_without_a_network_request(self):
        self.inventory.write_text('No dependencies were resolved\n')
        with patch.object(audit.urllib.request, 'urlopen') as request:
            with self.assertRaisesRegex(ValueError, 'inventory is empty'):
                audit.audit(self.inventory)
        request.assert_not_called()

    def test_propagates_network_failure_instead_of_reporting_a_clean_scan(self):
        with patch.object(audit.urllib.request, 'urlopen', side_effect=OSError('network unavailable')):
            with self.assertRaisesRegex(OSError, 'network unavailable'):
                audit.audit(self.inventory)


if __name__ == '__main__':
    unittest.main()
